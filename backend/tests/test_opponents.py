"""Preparation must not turn absent evidence, mixed speeds or losses into invented weaknesses."""
import asyncio
import datetime as dt
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import chess
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

import db
from routers import opponents as api
from services import opponents as service

MOVES = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7'


def pgn(white='Target', black='Other', result='1-0', speed='600+0', moves=MOVES, day=None, site='g0000001'):
    day = day or (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).strftime('%Y.%m.%d')
    return f'[Event "Rated game"]\n[Site "https://lichess.org/{site}"]\n[Date "{day}"]\n[White "{white}"]\n[Black "{black}"]\n[WhiteElo "1600"]\n[BlackElo "1800"]\n[Result "{result}"]\n[TimeControl "{speed}"]\n\n{moves} {result}\n'


def raw(text, **kwargs):
    return {'pgn': text, 'rated': True, **kwargs}


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch('db.DB_PATH', Path(self.tmp.name) / 'app.db'); self.db_patch.start(); db.init()
        self.filters = {'days': 180, 'max_games': 100, 'speed': 'all', 'rated_only': False}
        app = FastAPI(); app.include_router(api.router); self.client = TestClient(app)
        self.body = {'platform': 'lichess', 'username': 'target', 'days': 180, 'max_games': 100, 'speed': 'all', 'rated_only': True}

    def tearDown(self):
        self.client.close(); self.db_patch.stop(); self.tmp.cleanup()

    def build(self, rows, user='target', **filters):
        return service.build_report('lichess', user, {**self.filters, **filters}, rows)

    def import_report(self, **kwargs):
        response = self.client.post('/api/opponents/import', json={**self.body, 'pgn': pgn(), **kwargs})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_results_color_denominators_and_opposition(self):
        report, games = self.build([raw(pgn(site='g0000001')), raw(pgn(result='1/2-1/2', site='g0000002')), raw(pgn(white='Other', black='TARGET', result='1-0', site='g0000003'))])
        self.assertEqual(report['summary']['games'], 3)
        self.assertEqual(report['summary']['win_percent'], 33.3)
        self.assertEqual(report['summary']['score_percent'], 50)
        self.assertEqual(report['by_color'][0]['games'], 2)
        self.assertEqual(report['by_color'][1]['games'], 1)
        for row in report['openings']:
            self.assertLessEqual(row['games'], row['color_games'])
        self.assertEqual(games[0]['observations']['castle'], {'move': 5, 'side': 'king'})
        self.assertEqual(report['summary']['rating_pairs'], 3)

    def test_no_clock_or_eval_is_unknown_not_zero_error_or_bad_time(self):
        report, _ = self.build([raw(pgn())])
        clocks = next(x for x in report['observations'] if x['key'] == 'time_pressure')
        self.assertEqual(clocks['sample'], 0); self.assertIsNone(clocks['percent'])
        self.assertEqual(report['engine']['evaluated_moves'], 0)
        self.assertEqual(report['engine']['errors'], [])
        self.assertTrue(any('Chưa có cặp đánh giá' in x for x in report['warnings']))

    def test_clock_uses_actual_player_and_threshold(self):
        text = pgn(moves='1. e4 {[%clk 0:00:05]} e5 {[%clk 0:09:59]} 2. Nf3 Nc6')
        white, _ = self.build([raw(text)]); black, _ = self.build([raw(text)], user='other')
        def clock(r): return next(x for x in r['observations'] if x['key'] == 'time_pressure')
        self.assertEqual(clock(white)['count'], 1); self.assertEqual(clock(black)['count'], 0)

    def test_source_eval_sign_is_correct_for_black(self):
        text = pgn(moves='{[%eval -4.0]} 1. e4 {[%eval -4.0]} e5 {[%eval 0.0]} 2. Nf3 {[%eval 0.0]} Nc6 {[%eval 0.0]}')
        report, _ = self.build([raw(text)], user='other')
        errors = report['engine']['errors']
        self.assertEqual(len(errors), 1); self.assertEqual(errors[0]['ply'], 2)
        self.assertGreater(errors[0]['win_percent_loss'], 10)

    def test_unfinished_variants_invalid_other_players_and_old_games_are_skipped(self):
        old = pgn(day='2001.01.01')
        invalid = pgn(moves='1. e4 e5 2. Bh6')
        variant = pgn().replace('[Event', '[Variant "Chess960"]\n[Event', 1)
        rows = [raw(pgn()), raw(pgn(result='*')), raw(invalid), raw(variant), raw(pgn(white='Someone', black='Else')), raw(old)]
        report, _ = self.build(rows)
        self.assertEqual(report['summary']['games'], 1)
        self.assertEqual(sum(report['skipped'].values()), 5)

    def test_deduplication_and_distinct_source_game_ids(self):
        a = pgn(); b = a.replace('g0000001', 'g0000002')
        report, _ = self.build([raw(a), raw(a.replace('1. e4', '1. e4 {note}')), raw(b)])
        self.assertEqual(report['summary']['games'], 2); self.assertEqual(report['skipped']['duplicate'], 1)

    def test_speed_and_rated_filters_are_real_filters(self):
        report, games = self.build([raw(pgn()), raw(pgn(speed='60+0', site='g0000002'))], speed='rapid')
        self.assertEqual(len(games), 1); self.assertEqual(games[0]['speed'], 'rapid')
        with self.assertRaises(ValueError):
            self.build([raw(pgn(), rated=False)], rated_only=True)
        with self.assertRaises(ValueError):
            self.build([raw(pgn(), rated=None)], rated_only=True)

    def test_mixed_speeds_warn_and_do_not_create_habit_counter_plans(self):
        report, _ = self.build([raw(pgn()), raw(pgn(speed='60+0', site='g0000002'))])
        self.assertTrue(any('nhiều tốc độ' in w for w in report['warnings']))
        self.assertFalse(any('Giả thuyết:' in p['title'] for p in report['plan']))

    def test_evidence_and_branch_positions_replay_exactly(self):
        report, games = self.build([raw(pgn())]); ids = {g['id'] for g in games}
        for b in report['branches']:
            board = chess.Board()
            for san in b['moves'].split(): board.push_san(san)
            self.assertEqual(board.fen(), b['fen']); self.assertTrue(set(b['evidence']) <= ids)
        for o in report['observations']: self.assertTrue(set(o['evidence']) <= ids)

    def test_profile_urls_are_validated_without_arbitrary_fetches(self):
        self.assertEqual(service.username('https://www.chess.com/member/TaRgEt', 'chesscom'), 'target')
        self.assertEqual(service.username('https://lichess.org/@/TaRgEt', 'lichess'), 'target')
        for value in ['https://example.org/@/target', 'http://lichess.org/@/target', 'https://lichess.org:443/@/target', 'https://lichess.org/api/user/target', '../target', 'a?b', 'a/b']:
            with self.assertRaises(ValueError, msg=value): service.username(value, 'lichess')
        self.assertEqual(service.safe_game_url('javascript:alert(1)', 'lichess'), '')

    def test_import_roundtrip_rename_notes_export_delete_and_restart(self):
        report = self.import_report(); id = report['id']; base = '/api/opponents/' + id
        self.assertFalse(report['filters']['rated_only'])
        self.assertEqual(self.client.patch(base, json={'title': 'HLV A · chuẩn bị 20/11', 'notes': 'Tôi cầm Đen: …'}).status_code, 200)
        db.init()
        restored = self.client.get(base).json(); self.assertEqual(restored['notes'], 'Tôi cầm Đen: …')
        self.assertEqual(restored['title'], 'HLV A · chuẩn bị 20/11'); self.assertTrue(restored['cached'])
        game = self.client.get(base + '/games/' + report['games'][0]['id']).json()
        self.assertEqual(len(game['fens']), game['plies'] + 1)
        export = self.client.get(base + '/pgn'); self.assertEqual(export.status_code, 200); self.assertIn('[White "Target"]', export.text)
        self.assertNotIn('games', self.client.get('/api/opponents').json()[0])
        self.assertEqual(self.client.delete(base).status_code, 200)
        self.assertEqual(self.client.get(base).status_code, 404)

    def test_validation_and_missing_games(self):
        self.assertEqual(self.client.post('/api/opponents/collect', json={**self.body, 'max_games': 10000}).status_code, 422)
        self.assertEqual(self.client.post('/api/opponents/import', content=b'bad').status_code, 422)
        self.assertEqual(self.client.get('/api/opponents/bad').status_code, 422)
        report = self.import_report(); base = '/api/opponents/' + report['id']
        self.assertEqual(self.client.get(base + '/games/not-found').status_code, 404)
        self.assertEqual(self.client.patch(base, json={'title': ' ', 'notes': ''}).status_code, 422)
        self.assertEqual(self.client.patch(base, json={'title': 'x', 'notes': 'a' * 10001}).status_code, 422)
        self.assertEqual(self.client.post('/api/opponents/import', json={**self.body, 'username': 'nobody', 'pgn': pgn()}).status_code, 422)

    def test_cache_hit_and_failed_refresh_keep_previous_data_and_notes(self):
        collector = AsyncMock(return_value=({'username': 'Target'}, [raw(pgn())], {'scanned': 1}))
        with patch.object(service, 'collect', collector):
            a = self.client.post('/api/opponents/collect', json=self.body)
            self.assertEqual(a.status_code, 200, a.text)
            id = a.json()['id']; base = '/api/opponents/' + id
            self.client.patch(base, json={'title': 'Đối thủ A', 'notes': 'Đã chuẩn bị'})
            b = self.client.post('/api/opponents/collect', json=self.body)
            self.assertTrue(b.json()['cached']); self.assertEqual(collector.await_count, 1)
            collector.side_effect = service.SourceError('Rate limit', 429)
            self.assertEqual(self.client.post('/api/opponents/collect', json={**self.body, 'refresh': True}).status_code, 429)
        self.assertEqual(self.client.get(base).json()['notes'], 'Đã chuẩn bị')
        with db.conn() as c: self.assertEqual(c.execute('SELECT COUNT(*) FROM games').fetchone()[0], 0)

    def test_local_review_reused_only_on_explicit_recalculation_and_not_from_vault(self):
        import zlib
        report = self.import_report(); base = '/api/opponents/' + report['id']
        game = self.client.get(base + '/games/' + report['games'][0]['id']).json()
        key = hashlib.sha256('\\n'.join(game['fens']).encode()).hexdigest()
        score = {'cp': 0, 'mate': None, 'mateWinner': None, 'depth': 16, 'limited': False}
        snapshot = {'version': 2, 'engine': 'stockfish-19-lite', 'scores': [score] * 3, 'playedScores': [{**score, 'cp': -400}, score, score]}
        with db.conn() as c:
            c.execute('INSERT INTO saved_reviews VALUES(?,?,?,?,?,?)', ('import:' + key, key, None, b'{}', zlib.compress(json.dumps(snapshot).encode()), 1))
        self.assertEqual(self.client.get(base).json()['engine']['evaluated_moves'], 0)
        updated = self.client.post(base + '/recalculate').json()
        self.assertEqual(updated['engine']['games_with_local_evals'], 1)
        self.assertEqual(updated['engine']['errors'][0]['ply'], 1)
        self.assertEqual(updated['sample_until'], report['sample_until'])
        self.assertEqual(updated['summary']['games'], 1)
        with db.conn() as c:
            c.execute('DELETE FROM saved_reviews')
            c.execute("INSERT INTO library_items(id,kind,title) VALUES(1,'file','Private PGN')")
            c.execute('INSERT INTO saved_reviews VALUES(?,?,?,?,?,?)', ('library:1:' + key, key, 1, b'encrypted', b'encrypted', 1))
        self.assertEqual(self.client.post(base + '/recalculate').json()['engine']['games_with_local_evals'], 0)


class CollectorTests(unittest.IsolatedAsyncioTestCase):
    async def run_source(self, platform, handler, **filters):
        cls = httpx.AsyncClient
        with patch.object(service.httpx, 'AsyncClient', side_effect=lambda **kw: cls(transport=httpx.MockTransport(handler), **kw)):
            return await service.collect(platform, 'target', {'days': 180, 'max_games': 100, 'speed': 'all', 'rated_only': True, **filters})

    async def test_lichess_requests_finished_standard_with_clocks_evals_and_filters(self):
        seen = []; now = int(dt.datetime.now(dt.timezone.utc).timestamp())
        def handler(r):
            seen.append(r)
            if '/api/user/' in r.url.path: return httpx.Response(200, json={'username': 'Target'})
            self.assertEqual(r.url.params['ongoing'], 'false'); self.assertEqual(r.url.params['finished'], 'true')
            self.assertEqual(r.url.params['evals'], 'true'); self.assertEqual(r.url.params['clocks'], 'true')
            self.assertEqual(r.url.params['perfType'], 'rapid')
            rows = [{'id': 'abcdefgh', 'status': 'mate', 'variant': 'standard', 'speed': 'rapid', 'createdAt': (now - 10) * 1000, 'lastMoveAt': now * 1000, 'rated': True, 'pgn': pgn()}, {'id': 'abcdefgh', 'status': 'started'}]
            return httpx.Response(200, content='\n'.join(json.dumps(x) for x in rows))
        _, games, _ = await self.run_source('lichess', handler, speed='rapid')
        self.assertEqual(len(games), 1); self.assertEqual(len(seen), 2)

    async def test_chesscom_uses_canonical_months_not_archive_urls_and_skips_variants(self):
        seen = []; now = int(dt.datetime.now(dt.timezone.utc).timestamp()); month = dt.datetime.now(dt.timezone.utc).strftime('%Y/%m')
        def handler(r):
            seen.append(str(r.url)); self.assertEqual(r.url.host, 'api.chess.com')
            if r.url.path.endswith('/archives'): return httpx.Response(200, json={'archives': ['http://127.0.0.1/private', f'https://api.chess.com/pub/player/target/games/{month}']})
            if not '/games/' in r.url.path: return httpx.Response(200, json={'username': 'Target'})
            game = {'url': 'https://www.chess.com/game/live/123', 'end_time': now - 10, 'rules': 'chess', 'time_class': 'rapid', 'rated': True, 'pgn': pgn()}
            return httpx.Response(200, json={'games': [game, {**game, 'rules': 'chess960'}]})
        _, games, _ = await self.run_source('chesscom', handler)
        self.assertEqual(len(games), 1); self.assertEqual(len(seen), 3)

    async def test_network_rate_limit_and_redirect_are_not_silently_empty_profiles(self):
        for code in (429, 404, 302):
            with self.assertRaises(service.SourceError):
                await self.run_source('lichess', lambda r: httpx.Response(code, headers={'Location': 'http://127.0.0.1'}))
        with self.assertRaises(service.SourceError):
            await self.run_source('lichess', lambda r: httpx.Response(200, json=[]))

    async def test_response_size_is_bounded_before_json_parse(self):
        with patch.object(service, 'MAX_RESPONSE', 10):
            with self.assertRaises(service.SourceError):
                await self.run_source('lichess', lambda r: httpx.Response(200, content='x' * 100))


if __name__ == '__main__':
    unittest.main()
