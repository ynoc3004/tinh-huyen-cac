"""Tournament integrity and adversarial draws, isolated from real app.db."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import random
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db
from main import app
from fastapi.testclient import TestClient
from services import pairing


class PairingAlgorithmTests(unittest.TestCase):
    def test_global_match_escapes_greedy_dead_end(self):
        history = [(1, 4, "1/2"), (2, 3, "1/2"), (3, 4, "1/2")]
        pairs = pairing.swiss_pair([1, 2, 3, 4], history, seed=9)
        self.assertEqual({frozenset(p) for p in pairs}, {frozenset((1, 3)), frozenset((2, 4))})

    def test_bye_is_selected_with_matching_feasibility(self):
        pairs = pairing.swiss_pair([1, 2, 3], [(1, 2, "1/2")], seed=1)
        bye = next(w for w, b in pairs if b is None)
        self.assertNotEqual(bye, 3, "Lowest-score bye would force a rematch")
        self.assertTrue(any(3 in p for p in pairs if p[1] is not None))

    def test_exhausted_opponents_raise_instead_of_repeat(self):
        with self.assertRaises(pairing.PairingError):
            pairing.swiss_pair([1, 2], [(1, 2, "1/2")])

    def test_no_second_bye_when_all_players_already_had_one(self):
        with self.assertRaises(pairing.PairingError):
            pairing.swiss_pair([1, 2, 3], [(i, None, "bye") for i in range(1, 4)])

    def test_absolute_colour_preference_enforced(self):
        history = [(1, 9, "1/2"), (1, 10, "1/2"), (2, 11, "1/2"), (2, 12, "1/2")]
        with self.assertRaises(pairing.PairingError):
            pairing.swiss_pair([1, 2], history)
        # Arena remains playable even if hard Swiss constraints cannot be met.
        self.assertEqual(len(pairing.arena_pair([1, 2], history)), 1)

    def test_reproducible_despite_input_order_and_rating_ties(self):
        ids = list(range(1, 20))
        first = pairing.swiss_pair(ids, [], seed=123)
        self.assertEqual(first, pairing.swiss_pair(ids[::-1], [], seed=123))
        players = [(i, 1200, "CLB" if i % 2 else None) for i in ids]
        self.assertEqual(pairing.draw_groups(players, 3, seed=123), pairing.draw_groups(players[::-1], 3, seed=123))

    def test_many_tournaments_respect_hard_constraints(self):
        # Outcomes alter score groups and colour demands; stop explicitly on infeasibility.
        completed = 0
        for n in range(3, 33):
            for seed in range(3):
                rng = random.Random(seed)
                hist, seen, byes = [], set(), set()
                colours = {i: [] for i in range(1, n + 1)}
                for _ in range(pairing.recommended_swiss_rounds(n)):
                    try:
                        rnd = pairing.swiss_pair(list(colours), hist, seed=seed)
                    except pairing.PairingError:
                        break
                    present = []
                    for w, b in rnd:
                        present.append(w)
                        if b is None:
                            self.assertNotIn(w, byes); byes.add(w)
                            hist.append((w, b, "bye")); continue
                        present.append(b)
                        key = frozenset((w, b)); self.assertNotIn(key, seen); seen.add(key)
                        for x, c in ((w, "w"), (b, "b")):
                            colours[x].append(c)
                            cs = colours[x]
                            self.assertLessEqual(abs(cs.count("w") - cs.count("b")), 2)
                            self.assertNotIn("www", "".join(cs)); self.assertNotIn("bbb", "".join(cs))
                        hist.append((w, b, rng.choice(list(pairing.SCORE))))
                    self.assertEqual(sorted(present), list(colours))
                    completed += 1
        self.assertGreater(completed, 300)

    def test_arena_repeat_swaps_colours_and_odd_player_waits(self):
        self.assertEqual(pairing.arena_pair([1, 2], [(1, 2, "1-0")]), [(2, 1)])
        rnd = pairing.arena_pair([1, 2, 3], [(1, 2, "1/2")])
        self.assertEqual(len(rnd), 1)
        self.assertIn(3, rnd[0], "The player who waited should not be left out again")

    def test_round_robin_rest_awards_zero_points(self):
        rows = [(w, b, "bye" if b is None else "1/2", r) for r, pairs in enumerate(pairing.round_robin([1, 2, 3]), 1) for w, b in pairs]
        st = pairing.standings(rows, "round_robin")
        self.assertEqual([s["points"] for s in st], [1, 1, 1])
        self.assertEqual([s["rank"] for s in st], [1, 1, 1])

    def test_2026_bye_dummy_is_capped_at_half_declared_rounds(self):
        st = {s["student_id"]: s for s in pairing.standings([(1, None, "bye", 1), (1, 2, "1-0", 2), (1, 3, "1-0", 3)], total_rounds=3)}
        self.assertEqual(st[1]["points"], 3)
        self.assertEqual(st[1]["bh"], 1.5)
        self.assertEqual(st[1]["sb"], 1.5)


class TournamentIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.patcher = patch.object(db, "DB_PATH", Path(self.tmp.name) / "test.db")
        self.patcher.start(); self.addCleanup(self.patcher.stop)
        db.init()
        self.client = TestClient(app)
        self.ids = self.client.post('/api/students', json=[{'name': f'P{i}', 'rating': 2000-i*10} for i in range(17)]).json()['student_ids']

    def tour(self, fmt='swiss', n=8):
        data = self.client.post('/api/tournaments/from-draw', json={'name': 'Official rehearsal', 'seed': 42, 'format': fmt, 'groups': [self.ids[:n]]}).json()
        tid = data['tournament_id']
        gid = self.client.get(f'/api/tournaments/{tid}').json()['groups'][0]['id']
        return tid, gid

    def rows(self, gid):
        return self.client.get(f'/api/groups/{gid}/pairings').json()

    def complete(self, gid, result='1/2'):
        for p in self.rows(gid):
            if p['black_id'] is not None and not p['result']:
                self.assertEqual(self.client.put(f'/api/pairings/{p["id"]}', json={'result': result}).status_code, 200)

    def test_draw_capacity_and_replay(self):
        body = {'student_ids': self.ids, 'group_size': 8, 'seed': 123}
        a = self.client.post('/api/draw', json=body).json()
        b = self.client.post('/api/draw', json={**body, 'student_ids': self.ids[::-1]}).json()
        self.assertEqual(a, b)
        self.assertEqual(len(a['groups']), 3)
        self.assertLessEqual(max(len(g['ids']) for g in a['groups']), 8)

    def test_published_schedule_cannot_be_reset_accidentally(self):
        tid, gid = self.tour()
        self.assertEqual(self.client.post(f'/api/groups/{gid}/pair').status_code, 200)
        rows = self.rows(gid)
        self.assertEqual(self.client.post(f'/api/groups/{gid}/pair').status_code, 409)
        self.assertEqual(self.rows(gid), rows)
        self.assertEqual(self.client.post(f'/api/groups/{gid}/pair?force=true').status_code, 200)
        events = self.client.get(f'/api/tournaments/{tid}/audit').json()['events']
        self.assertEqual(next(e['details']['pairings'] for e in events if e['action']=='schedule_before_reset'), rows)

    def test_round_limit_frozen_and_early_final_or_finish_blocked(self):
        tid, gid = self.tour()
        self.assertEqual(self.client.patch(f'/api/groups/{gid}', json={'swiss_rounds': 2}).status_code, 200)
        self.assertEqual(self.client.post(f'/api/groups/{gid}/pair').json()['rounds'], 2)
        self.assertEqual(self.client.patch(f'/api/groups/{gid}', json={'swiss_rounds': 3}).status_code, 409)
        self.complete(gid)
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/finals', json={'per_group': 2}).status_code, 409)
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/finish').status_code, 409)
        self.assertEqual(self.client.post(f'/api/groups/{gid}/swiss-next').status_code, 200)
        self.complete(gid)
        self.assertEqual(self.client.post(f'/api/groups/{gid}/swiss-next').status_code, 409)
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/finish').status_code, 200)
        self.assertEqual(self.client.post(f'/api/groups/{gid}/pair?force=true').status_code, 409)

    def test_old_result_locked_but_metrics_can_be_updated(self):
        _, gid = self.tour()
        self.client.post(f'/api/groups/{gid}/pair'); self.complete(gid)
        old = self.rows(gid)[0]
        self.client.post(f'/api/groups/{gid}/swiss-next')
        self.assertEqual(self.client.put(f'/api/pairings/{old["id"]}', json={'result':'1-0'}).status_code, 409)
        self.assertEqual(self.client.put(f'/api/pairings/{old["id"]}', json={'result':'1/2', 'white_technical_errors':2}).status_code, 200)
        self.assertEqual(self.rows(gid)[0]['result'], '1/2')

    def test_concurrent_swiss_pairing_creates_exactly_one_round(self):
        _, gid = self.tour()
        self.client.post(f'/api/groups/{gid}/pair'); self.complete(gid)
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: self.client.post(f'/api/groups/{gid}/swiss-next').status_code, range(2)))
        self.assertEqual(sorted(statuses), [200, 400])
        rnd = [p for p in self.rows(gid) if p['round']==2]
        self.assertEqual(len(rnd), 4)
        self.assertEqual(len({sid for p in rnd for sid in (p['white_id'],p['black_id'])}), 8)

    def test_no_legal_swiss_round_leaves_database_unchanged(self):
        _, gid = self.tour(n=4)
        self.client.patch(f'/api/groups/{gid}', json={'swiss_rounds':3})
        self.client.post(f'/api/groups/{gid}/pair'); self.complete(gid)
        before = self.rows(gid)
        with patch.object(pairing, 'swiss_pair', side_effect=pairing.PairingError('No legal draw')):
            self.assertEqual(self.client.post(f'/api/groups/{gid}/swiss-next').status_code,409)
        self.assertEqual(before, self.rows(gid))

    def test_unresolved_qualification_tie_does_not_choose_by_database_id(self):
        tid, gid = self.tour(fmt='round_robin', n=4)
        self.client.post(f'/api/groups/{gid}/pair'); self.complete(gid)
        st = self.client.get(f'/api/groups/{gid}/standings').json()
        self.assertEqual([s['rank'] for s in st], [1,1,1,1])
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/finals', json={'per_group':2}).status_code,409)
        self.assertEqual(len(self.client.get(f'/api/tournaments/{tid}').json()['groups']),1)

    def test_knockout_champion_uses_final_not_total_points(self):
        tid, gid = self.tour(fmt='round_robin', n=5)
        self.client.post(f'/api/groups/{gid}/pair'); self.complete(gid)
        final = self.client.post(f'/api/tournaments/{tid}/finals', json={'per_group':5}).json()['group_id']
        # Re-seed the knockout, allowing seed 1 to advance with a bye but lose the final.
        self.client.post(f'/api/groups/{final}/next-round')
        self.complete(final, '1-0')
        self.client.post(f'/api/groups/{final}/next-round'); self.complete(final, '1-0')
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/finish').status_code,409)
        self.client.post(f'/api/groups/{final}/next-round')
        last = max(self.rows(final), key=lambda p:p['round'])
        self.assertEqual(self.client.put(f'/api/pairings/{last["id"]}', json={'result':'0-1'}).status_code,200)
        expected = next(p['name'] for p in self.client.get(f'/api/tournaments/{tid}').json()['groups'][-1]['players'] if p['id']==last['black_id'])
        result = self.client.post(f'/api/tournaments/{tid}/finish').json()
        self.assertEqual(result['groups'][-1]['champion'], expected)
        self.assertEqual(result['groups'][-1]['standings'][0]['name'], expected)
        self.assertEqual(result['groups'][-1]['standings'][0]['rank'], 1)
        self.assertEqual(self.client.put(f'/api/pairings/{last["id"]}', json={'result':'1-0'}).status_code,409)

    def test_wrong_pairing_endpoint_and_naive_arena_clock(self):
        _, gid = self.tour(fmt='round_robin', n=2)
        self.client.post(f'/api/groups/{gid}/pair')
        pid = self.rows(gid)[0]['id']
        self.assertEqual(self.client.put(f'/api/arenas/pairings/{pid}', json={'result':'1-0'}).status_code,400)
        a = self.client.post('/api/arenas', json={'name':'Arena', 'student_ids':self.ids[:2]}).json()
        tid = a['tournament_id']
        self.client.post(f'/api/arenas/{tid}/start')
        with db.conn() as c: c.execute("UPDATE tournaments SET ends_at='2000-01-01T00:00:00' WHERE id=?", (tid,))
        self.assertEqual(self.client.post(f'/api/arenas/{tid}/pair').status_code,400)
        self.assertEqual(self.client.get(f'/api/arenas/{tid}').json()['status'],'finished')

    def test_audit_persists_and_is_downloadable(self):
        tid, gid = self.tour()
        self.client.post(f'/api/groups/{gid}/pair'); self.complete(gid)
        before = self.client.get(f'/api/tournaments/{tid}/audit').json()
        db.init()
        self.assertEqual(before, TestClient(app).get(f'/api/tournaments/{tid}/audit').json())
        r = self.client.get(f'/api/tournaments/{tid}/audit?download=true')
        self.assertIn('attachment', r.headers['content-disposition'])
        self.assertEqual(r.json(), before)
        pair_event = next(e for e in before['events'] if e['action']=='pair_round_1')
        self.assertEqual(len(pair_event['details']['players']),8)
        self.assertTrue(any(e['action']=='result' and e['details']['before']['result'] is None for e in before['events']))

    def test_invalid_format_and_wrong_group_rejected(self):
        self.assertEqual(self.client.post('/api/draw', json={'mode':'bad'}).status_code,400)
        self.assertEqual(self.client.post('/api/tournaments', json={'name':'X','format':'bad'}).status_code,400)
        _, gid = self.tour(fmt='round_robin')
        self.assertEqual(self.client.post(f'/api/groups/{gid}/next-round').status_code,400)
        self.assertEqual(self.client.post('/api/groups/999999/pair').status_code,404)

    def test_bulk_error_rolls_back_results_and_audit(self):
        tid, gid = self.tour()
        self.client.post(f'/api/groups/{gid}/pair')
        before = self.rows(gid)
        events = self.client.get(f'/api/tournaments/{tid}/audit').json()['events']
        r = self.client.put(f'/api/groups/{gid}/results/bulk', json={'items':[
            {'id':before[0]['id'],'result':'1-0'}, {'id':before[1]['id'],'result':'invalid'}]})
        self.assertEqual(r.status_code,400)
        self.assertEqual(self.rows(gid),before)
        self.assertEqual(self.client.get(f'/api/tournaments/{tid}/audit').json()['events'],events)

    def test_missing_board_prevents_finishing_partial_schedule(self):
        tid, gid = self.tour(fmt='round_robin', n=4)
        self.client.post(f'/api/groups/{gid}/pair'); self.complete(gid)
        p = self.rows(gid)[0]
        with db.conn() as c: c.execute('DELETE FROM pairings WHERE id=?', (p['id'],))
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/finish').status_code,409)


if __name__ == '__main__':
    unittest.main()
