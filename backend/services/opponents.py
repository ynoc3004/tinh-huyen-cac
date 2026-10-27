"""Preparation from finished public games. Observations retain denominators and evidence."""
import asyncio
import collections
import datetime as dt
import functools
import hashlib
import io
import json
import math
import re
import time
import zlib
from pathlib import Path
from urllib.parse import urlparse

import chess
import chess.pgn
import httpx

from config import UA

VERSION = 1
SPEEDS = {'all', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'}
MAX_RESPONSE = 24 * 1024 * 1024
MAX_PGN = 512 * 1024
MAX_PLIES = 800
NETWORK_LOCK = asyncio.Lock()
FINISHED = {'mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'variantEnd'}


class SourceError(ValueError):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def username(value, platform):
    value = value.strip()
    if '://' in value:
        parsed = urlparse(value)
        hosts = {'chesscom': {'chess.com', 'www.chess.com'}, 'lichess': {'lichess.org', 'www.lichess.org'}}
        if parsed.scheme != 'https' or parsed.hostname not in hosts.get(platform, set()) or parsed.username or parsed.port:
            raise ValueError('Hãy dùng nick hoặc đường dẫn hồ sơ HTTPS của đúng nền tảng.')
        parts = parsed.path.strip('/').split('/')
        if len(parts) != 2 or parts[0] != ('member' if platform == 'chesscom' else '@'):
            raise ValueError('Đường dẫn cần có dạng chess.com/member/nick hoặc lichess.org/@/nick.')
        value = parts[1]
    if platform not in {'chesscom', 'lichess'} or not re.fullmatch(r'[A-Za-z0-9_-]{2,30}', value):
        raise ValueError('Nick cần có 2–30 ký tự: chữ không dấu, số, dấu gạch ngang hoặc gạch dưới.')
    return value.lower()


def report_id(platform, user, filters):
    key = json.dumps([VERSION, platform, user, filters], sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:24]


def speed_from_control(control):
    try:
        if '/' in control:
            return 'correspondence'
        base, _, inc = control.partition('+')
        seconds = int(base) + 40 * int(inc or 0)
        if seconds >= 86400:
            return 'correspondence'
        return 'bullet' if seconds < 180 else 'blitz' if seconds < 600 else 'rapid' if seconds < 1800 else 'classical'
    except (TypeError, ValueError):
        return 'unknown'


def utc_timestamp(headers):
    date = headers.get('UTCDate', headers.get('Date', ''))
    clock = headers.get('UTCTime', '00:00:00')
    try:
        return int(dt.datetime.strptime(date + ' ' + clock, '%Y.%m.%d %H:%M:%S').replace(tzinfo=dt.timezone.utc).timestamp())
    except ValueError:
        return None


async def request(client, url, **kwargs):
    # Construct hosts/paths ourselves; never follow URLs supplied by an archive or profile.
    async with client.stream('GET', url, **kwargs) as response:
        if response.status_code == 404:
            raise SourceError('Không tìm thấy tài khoản công khai. Kiểm tra lại nick và nền tảng.', 404)
        if response.status_code == 429:
            raise SourceError('Nền tảng đang giới hạn lượt tải. Hồ sơ cũ vẫn còn; hãy thử cập nhật sau ít nhất một phút.', 429)
        if response.status_code != 200:
            raise SourceError(f'Nền tảng trả HTTP {response.status_code}. Có thể nhập PGN để tiếp tục.')
        raw = bytearray()
        async for chunk in response.aiter_bytes():
            raw.extend(chunk)
            if len(raw) > MAX_RESPONSE:
                raise SourceError('Dữ liệu tải quá lớn. Hãy giảm số ván hoặc khoảng thời gian.')
    return bytes(raw)


def json_response(raw):
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise SourceError('Nền tảng trả dữ liệu không hợp lệ. Hồ sơ cũ được giữ nguyên.')


async def collect(platform, user, filters, now=None):
    now = int(now or time.time())
    since = now - filters['days'] * 86400
    games, scanned, notes = [], 0, []
    async with NETWORK_LOCK:
        async with httpx.AsyncClient(headers=UA, timeout=httpx.Timeout(90, connect=15), follow_redirects=False) as client:
            if platform == 'chesscom':
                data = json_response(await request(client, f'https://api.chess.com/pub/player/{user}'))
                profile = {'username': data.get('username', user), 'title': data.get('title', ''), 'url': f'https://www.chess.com/member/{user}'}
                data = json_response(await request(client, f'https://api.chess.com/pub/player/{user}/games/archives'))
                months = set()
                for url in data.get('archives', []):
                    match = re.fullmatch(r'https://api\.chess\.com/pub/player/[A-Za-z0-9_-]+/games/(\d{4})/(\d{2})', str(url))
                    if match and 1 <= int(match[2]) <= 12:
                        year, month = map(int, match.groups())
                        end = (dt.datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=dt.timezone.utc).timestamp())
                        if end > since and year * 12 + month <= dt.datetime.fromtimestamp(now, dt.timezone.utc).year * 12 + dt.datetime.fromtimestamp(now, dt.timezone.utc).month:
                            months.add((year, month))
                for year, month in sorted(months, reverse=True)[:25]:
                    data = json_response(await request(client, f'https://api.chess.com/pub/player/{user}/games/{year}/{month:02d}'))
                    for g in sorted(data.get('games', []), key=lambda g: g.get('end_time', 0), reverse=True):
                        scanned += 1
                        speed = g.get('time_class', 'unknown')
                        speed = 'correspondence' if speed == 'daily' else speed
                        if g.get('rules') != 'chess' or not since <= g.get('end_time', 0) <= now or not speed_ok(speed, filters) or (filters['rated_only'] and not g.get('rated', False)):
                            continue
                        games.append({'pgn': g.get('pgn', ''), 'external_id': g.get('uuid') or g.get('url', ''), 'url': safe_game_url(g.get('url', ''), platform), 'played_at': g['end_time'], 'speed': speed, 'rated': g.get('rated', False), 'termination': g.get('white', {}).get('result', '') + '/' + g.get('black', {}).get('result', '')})
                    # Slice only after processing a complete month, keeping its newest games.
                    if len(games) >= filters['max_games']:
                        break
                games = games[:filters['max_games']]
                notes.append('Chess.com có thể trả dữ liệu lưu đệm tới 12 giờ; ván mới nhất có thể chưa xuất hiện.')
            else:
                data = json_response(await request(client, f'https://lichess.org/api/user/{user}'))
                profile = {'username': data.get('username', user), 'title': data.get('title', ''), 'url': f'https://lichess.org/@/{user}'}
                params = {'max': filters['max_games'], 'since': since * 1000, 'until': now * 1000, 'pgnInJson': 'true', 'clocks': 'true', 'evals': 'true', 'opening': 'true', 'ongoing': 'false', 'finished': 'true', 'sort': 'dateDesc', 'perfType': 'bullet,blitz,rapid,classical,correspondence' if filters['speed'] == 'all' else filters['speed']}
                if filters['rated_only']:
                    params['rated'] = 'true'
                raw = await request(client, f'https://lichess.org/api/games/user/{user}', params=params, headers={'Accept': 'application/x-ndjson'})
                for line in raw.splitlines():
                    if not line.strip():
                        continue
                    g = json_response(line); scanned += 1
                    if g.get('status') not in FINISHED or g.get('variant', 'standard') != 'standard':
                        continue
                    played = g.get('lastMoveAt', g.get('createdAt', 0)) // 1000
                    # The API filters createdAt; apply the same date convention on both platforms using finished time.
                    if not since <= played <= now or not speed_ok(g.get('speed'), filters) or (filters['rated_only'] and not g.get('rated', False)):
                        continue
                    games.append({'pgn': g.get('pgn', ''), 'external_id': g.get('id', ''), 'url': safe_game_url('https://lichess.org/' + g.get('id', ''), platform), 'played_at': played, 'speed': g.get('speed'), 'rated': g.get('rated', False), 'termination': g.get('status', '')})
    return profile, games, {'scanned': scanned, 'notes': notes, 'fetched_at': now}


def speed_ok(speed, filters):
    return speed in SPEEDS - {'all'} and (filters['speed'] == 'all' or filters['speed'] == speed)


def safe_game_url(url, platform):
    pattern = r'https://(?:www\.)?chess\.com/game/(?:live|daily)/\d+' if platform == 'chesscom' else r'https://lichess\.org/[A-Za-z0-9]{8}(?:[A-Za-z0-9]{4})?'
    return url if isinstance(url, str) and re.fullmatch(pattern, url) else ''


@functools.lru_cache(maxsize=1)
def openings():
    return json.loads((Path(__file__).parents[1] / 'static/openings-eco.json').read_text(encoding='utf-8'))['positions']


def read_game(raw):
    if not isinstance(raw, str) or len(raw.encode()) > MAX_PGN:
        return None
    try:
        stream = io.StringIO(raw)
        game = chess.pgn.read_game(stream)
        if game is None or game.errors or not game.board().is_valid() or game.board().fen() != chess.STARTING_FEN or game.headers.get('Variant', 'Standard').lower() not in {'standard', 'chess', 'normal'}:
            return None
        if chess.pgn.read_game(stream) is not None:
            return None
        if game.headers.get('Result') not in {'1-0', '0-1', '1/2-1/2'}:
            return None
        if not 4 <= sum(1 for _ in game.mainline_moves()) <= MAX_PLIES:
            return None
        return game
    except (ValueError, TypeError, IndexError):
        return None


def white_percent(cp):
    return 100 / (1 + math.exp(-.00368208 * max(-10000, min(10000, cp))))


def source_cp(node):
    value = node.eval()
    return value.white().score(mate_score=10000) if value is not None else None


def game_summary(game, raw, user, platform):
    h = game.headers
    if h.get('White', '').casefold() == user:
        color = chess.WHITE
    elif h.get('Black', '').casefold() == user:
        color = chess.BLACK
    else:
        return None
    target = 'White' if color else 'Black'
    result = h['Result']; outcome = 'draw' if result == '1/2-1/2' else 'win' if (result == '1-0') == color else 'loss'
    identity = hashlib.sha256(raw['pgn'].encode()).hexdigest()[:20]
    board = game.board(); opening = None; prefixes = []; sans = []; fens = [board.fen()]
    own_moves = pawn_moves = queen_moves = captures = checks = early_own = clock_moves = 0
    low_clock = False; castle = None; errors = []; evaluated = 0; evaluated_plies = []
    control = h.get('TimeControl', '')
    try:
        base, _, increment = control.partition('+'); base = int(base); increment = int(increment or 0)
    except ValueError:
        base = increment = 0
    clock_threshold = min(60, max(10, base * .05)) if 0 < base < 86400 else None
    for ply, node in enumerate(game.mainline(), 1):
        if node.move not in board.legal_moves:
            return None
        turn = board.turn; piece = board.piece_at(node.move.from_square); san = board.san(node.move)
        if turn == color:
            own_moves += 1
            if board.fullmove_number <= 10:
                early_own += 1; pawn_moves += piece.piece_type == chess.PAWN; queen_moves += piece.piece_type == chess.QUEEN
            captures += board.is_capture(node.move)
            if board.is_castling(node.move) and castle is None:
                castle = {'move': board.fullmove_number, 'side': 'king' if chess.square_file(node.move.to_square) == 6 else 'queen'}
            clock = node.clock()
            if clock is not None and clock_threshold is not None and 0 <= clock <= base + increment * own_moves:
                clock_moves += 1; low_clock |= clock <= clock_threshold
            before, after = source_cp(node.parent), source_cp(node)
            if before is not None and after is not None:
                evaluated += 1; evaluated_plies.append(ply); loss = (1 if color else -1) * (white_percent(before) - white_percent(after))
                if loss >= 10:
                    errors.append({'ply': ply, 'san': san, 'fen': board.fen(), 'before_cp': before, 'after_cp': after, 'win_percent_loss': round(loss, 1), 'phase': 'opening' if board.fullmove_number <= 12 else 'endgame' if len(board.piece_map()) <= 12 and not board.queens else 'middlegame', 'source': 'PGN', 'depth': node.eval_depth()})
        board.push(node.move); sans.append(san); fens.append(board.fen())
        if turn == color:
            checks += board.is_check()
        if ply <= 30:
            match = openings().get(' '.join(board.fen().split()[:3]))
            if match:
                opening = {'eco': match[0], 'name': match[1]}
        if ply <= 12:
            prefixes.append({'ply': ply, 'fen': board.fen(), 'moves': ' '.join(sans), 'uci': node.move.uci()})
    if opening is None:
        eco = h.get('ECO', '')
        opening = {'eco': eco if re.fullmatch('[A-E][0-9]{2}', eco) else '', 'name': h.get('Opening', '')[:200] or 'Chưa nhận diện · ' + ' '.join(sans[:4])}
    def rating(key):
        try:
            value = int(h.get(key, '')); return value if 0 < value < 4000 else None
        except ValueError:
            return None
    mine = rating(target + 'Elo'); theirs = rating(('Black' if color else 'White') + 'Elo')
    return {'id': identity, 'external_id': raw.get('external_id', ''), 'url': safe_game_url(raw.get('url', ''), platform), 'played_at': raw.get('played_at') or utc_timestamp(h), 'white': h.get('White', '')[:80], 'black': h.get('Black', '')[:80], 'opponent': h.get('Black' if color else 'White', '')[:80], 'color': 'white' if color else 'black', 'result': result, 'outcome': outcome, 'speed': raw.get('speed') or speed_from_control(control), 'rated': raw.get('rated'), 'time_control': control, 'rating': mine, 'opponent_rating': theirs, 'opening': opening, 'plies': len(sans), 'moves': sans, 'fens': fens, 'prefixes': prefixes, 'pgn': raw['pgn'], 'termination': raw.get('termination', h.get('Termination', '')), 'observations': {'own_moves': own_moves, 'early_own_moves': early_own, 'pawn_moves_first10': pawn_moves, 'queen_moves_first10': queen_moves, 'captures': captures, 'checks': checks, 'castle': castle, 'clock_moves': clock_moves, 'low_clock': low_clock, 'evaluated_moves': evaluated}, 'evaluated_plies': evaluated_plies, 'errors': errors}


def apply_saved_evaluations(games):
    """Reuse only public/local review snapshots; never query the encrypted vault."""
    from db import conn
    with conn() as c:
        for g in games:
            # Same position hash as review.js (a literal backslash+n separator).
            key = hashlib.sha256('\\n'.join(g['fens']).encode()).hexdigest()
            row = c.execute('SELECT payload FROM saved_reviews WHERE id=? AND item_id IS NULL', ('import:' + key,)).fetchone()
            if row is None:
                continue
            try:
                snapshot = json.loads(zlib.decompress(row['payload']))
                if snapshot.get('version') != 2 or snapshot.get('engine') != 'stockfish-19-lite':
                    continue
                scores, played = snapshot['scores'], snapshot['playedScores']
                if len(scores) > len(g['fens']) or len(played) > g['plies']:
                    continue
                covered = set(g['evaluated_plies']); errors = {e['ply']: e for e in g['errors']}; local = 0
                for i, (best, actual) in enumerate(zip(scores, played)):
                    if (i % 2 == 0) != (g['color'] == 'white'):
                        continue
                    def cp(score):
                        if score.get('mate') is not None and score.get('mateWinner') in {'w', 'b'}:
                            return 10000 if score['mateWinner'] == 'w' else -10000
                        value = score.get('cp')
                        return value if type(value) in (int, float) and math.isfinite(value) else None
                    before, after = cp(best), cp(actual)
                    if before is None or after is None:
                        continue
                    loss = (1 if g['color'] == 'white' else -1) * (white_percent(before) - white_percent(after))
                    covered.add(i + 1); local += 1; errors.pop(i + 1, None)
                    if loss >= 10:
                        b = chess.Board(g['fens'][i]); depth = min(best.get('depth', 0), actual.get('depth', 0))
                        errors[i + 1] = {'ply': i + 1, 'san': g['moves'][i], 'fen': g['fens'][i], 'before_cp': before, 'after_cp': after, 'win_percent_loss': round(loss, 1), 'phase': 'opening' if b.fullmove_number <= 12 else 'endgame' if len(b.piece_map()) <= 12 and not b.queens else 'middlegame', 'source': 'Stockfish local đã lưu', 'depth': depth, 'limited': bool(best.get('limited') or actual.get('limited') or best.get('depth') != actual.get('depth'))}
                g['errors'] = list(errors.values()); g['evaluated_plies'] = sorted(covered); g['observations']['evaluated_moves'] = len(covered); g['observations']['local_evaluated_moves'] = local
            except (ValueError, KeyError, TypeError, zlib.error):
                continue


def stats(games):
    c = collections.Counter(g['outcome'] for g in games); n = len(games)
    diffs = [g['rating'] - g['opponent_rating'] for g in games if g['rating'] is not None and g['opponent_rating'] is not None]
    return {'games': n, 'wins': c['win'], 'draws': c['draw'], 'losses': c['loss'], 'score_percent': round(100 * (c['win'] + c['draw'] / 2) / n, 1) if n else None, 'win_percent': round(100 * c['win'] / n, 1) if n else None, 'mean_rating_difference': round(sum(diffs) / len(diffs)) if diffs else None, 'rating_pairs': len(diffs), 'latest_rating_in_sample': next((g['rating'] for g in games if g['rating'] is not None), None)}


def group_stats(games, key):
    buckets = collections.defaultdict(list)
    for g in games:
        buckets[key(g)].append(g)
    return [{'key': k, **stats(v), 'evidence': [g['id'] for g in v[:5]]} for k, v in sorted(buckets.items(), key=lambda x: -len(x[1]))]


def build_report(platform, user, filters, raw_games, profile=None, acquisition=None, as_of=None):
    accepted, seen = [], set(); skipped = collections.Counter()
    until = int(as_of or time.time()); cutoff = until - filters['days'] * 86400
    for raw in raw_games:
        game = read_game(raw.get('pgn'))
        if game is None:
            skipped['invalid_unfinished_or_variant'] += 1; continue
        g = game_summary(game, raw, user, platform)
        if g is None:
            skipped['different_player_or_illegal'] += 1; continue
        if g['played_at'] is not None and not cutoff <= g['played_at'] <= until:
            skipped['outside_dates'] += 1; continue
        if not speed_ok(g['speed'], filters):
            skipped['different_speed'] += 1; continue
        if filters['rated_only'] and g['rated'] is not True:
            skipped['casual'] += 1; continue
        # Move identity prevents duplicate PGNs with changed comments/whitespace counting twice.
        source_id = raw.get('external_id') or safe_game_url(game.headers.get('Site', ''), platform)
        unique = ('source', source_id) if source_id else (g['white'].casefold(), g['black'].casefold(), game.headers.get('Date'), game.headers.get('UTCTime'), ' '.join(m.uci() for m in game.mainline_moves()))
        if unique in seen:
            skipped['duplicate'] += 1; continue
        seen.add(unique); accepted.append(g)
    accepted.sort(key=lambda g: g['played_at'] or 0, reverse=True)
    accepted = accepted[:filters['max_games']]
    if not accepted:
        raise ValueError('Chưa có ván tiêu chuẩn đã kết thúc khớp nick và bộ lọc. Thử mở rộng thời gian, đổi tốc độ hoặc nhập PGN có đúng tên người chơi.')
    apply_saved_evaluations(accepted)
    white = [g for g in accepted if g['color'] == 'white']; black = [g for g in accepted if g['color'] == 'black']
    opening_rows = []
    for color, group in [('white', white), ('black', black)]:
        for row in group_stats(group, lambda g: g['opening']['eco'] + ' · ' + g['opening']['name']):
            opening_rows.append({**row, 'color': color, 'frequency_percent': round(100 * row['games'] / len(group), 1), 'color_games': len(group)})
    branches = []
    for color, group in [('white', white), ('black', black)]:
        buckets = collections.defaultdict(list)
        for g in group:
            for prefix in g['prefixes']:
                buckets[(prefix['ply'], prefix['moves'])].append(g)
        for (ply, moves), bucket in buckets.items():
            if ply in {1, 2, 4, 6, 8, 10, 12}:
                sample = bucket[0]; prefix = sample['prefixes'][ply - 1]
                branches.append({'color': color, 'ply': ply, 'moves': moves, 'fen': prefix['fen'], **stats(bucket), 'frequency_percent': round(100 * len(bucket) / len(group), 1), 'evidence': [g['id'] for g in bucket[:5]]})
    observations = []
    eligible = [g for g in accepted if g['plies'] >= 20]
    for key, title, predicate in [
        ('early_castle', 'Nhập thành trong 10 nước đầu', lambda g: g['observations']['castle'] is not None and g['observations']['castle']['move'] <= 10),
        ('queen_early', 'Có di chuyển hậu trong 10 nước đầu', lambda g: g['observations']['queen_moves_first10'] > 0),
        ('no_castle', 'Chưa nhập thành sau 10 nước', lambda g: g['observations']['castle'] is None or g['observations']['castle']['move'] > 10),
    ]:
        found = [g for g in eligible if predicate(g)]
        observations.append({'key': key, 'title': title, 'count': len(found), 'sample': len(eligible), 'percent': round(100 * len(found) / len(eligible), 1) if eligible else None, 'evidence': [g['id'] for g in found[:5]], 'interpretation': 'Thói quen quan sát được; tự nó chưa chứng minh tốt/xấu hay phong cách tấn công/phòng thủ.'})
    clocks = [g for g in accepted if g['observations']['clock_moves']]
    low = [g for g in clocks if g['observations']['low_clock']]
    observations.append({'key': 'time_pressure', 'title': 'Có lúc xuống dưới ngưỡng thời gian thấp', 'count': len(low), 'sample': len(clocks), 'percent': round(100 * len(low) / len(clocks), 1) if clocks else None, 'evidence': [g['id'] for g in low[:5]], 'interpretation': 'Chỉ dùng các nước có đồng hồ: ngưỡng 5% thời gian ban đầu, tối thiểu 10 giây, tối đa 60 giây. Không suy ra thiếu thời gian từ số nước hoặc ván thua.'})
    errors = [{**e, 'game_id': g['id'], 'color': g['color'], 'speed': g['speed']} for g in accepted for e in g['errors']]
    evaluated = sum(g['observations']['evaluated_moves'] for g in accepted)
    warnings = ['Đây là mẫu ván online công khai, không phải toàn bộ năng lực hoặc dự báo kết quả giải trực tiếp.', 'Tỷ lệ thắng và điểm số khác nhau: hòa tính nửa điểm; chênh lệch rating và cỡ mẫu được giữ cạnh thống kê.']
    if len(accepted) < 30:
        warnings.append('Mẫu dưới 30 ván: nhận xét còn yếu, cần đối chiếu thêm các ván gần đây.')
    if len({g['speed'] for g in accepted}) > 1:
        warnings.append('Đang trộn nhiều tốc độ. Chọn đúng thời gian của giải trước khi lập kế hoạch đối phó.')
    if not evaluated:
        warnings.append('Chưa có cặp đánh giá engine trước/sau nước đi; chưa kết luận lỗi chiến thuật hoặc ưu thế bị bỏ lỡ. Mở ván ở bàn phân tích Stockfish để kiểm tra.')
    missing_dates = sum(g['played_at'] is None for g in accepted)
    if missing_dates:
        warnings.append(f'{missing_dates} ván thiếu ngày hợp lệ; không thể xác minh thuộc khoảng thời gian đã chọn.')
    plan = []
    for color, group in [('white', white), ('black', black)]:
        rows = [r for r in opening_rows if r['color'] == color]
        if rows:
            row = rows[0]; mine = 'Đen' if color == 'white' else 'Trắng'
            plan.append({'title': f'Khi bạn cầm {mine}: chuẩn bị nhánh gặp nhiều nhất', 'text': f'Đối thủ cầm {"Trắng" if color == "white" else "Đen"} dùng {row["key"]} trong {row["games"]}/{row["color_games"]} ván. Chọn cách đáp thuộc sở trường của bạn, xem các ván mẫu và luyện vị trí trung cuộc phát sinh; không đổi cả hệ khai cuộc chỉ vì tỷ lệ thắng của mẫu này.', 'evidence': row['evidence']})
    if errors:
        phases = collections.Counter(e['phase'] for e in errors); phase, count = phases.most_common(1)[0]
        name = {'opening': 'khai cuộc', 'middlegame': 'trung cuộc', 'endgame': 'tàn cuộc'}[phase]
        plan.append({'title': 'Kiểm tra các vị trí có dao động lớn', 'text': f'Có {count} nước ở {name} giảm ít nhất 10 điểm phần trăm theo mô hình đánh giá, trong {evaluated} nước có đủ đánh giá nguồn. Xem trực tiếp vị trí và tính lại với Stockfish trước khi chọn cách khai thác; chưa khái quát thành một điểm yếu cố định.', 'evidence': list(dict.fromkeys(e['game_id'] for e in errors if e['phase'] == phase))[:5]})
    mixed = len({g['speed'] for g in accepted}) > 1
    if not mixed:
        hypotheses = {
            'no_castle': ('Giả thuyết: kiểm tra an toàn vua ở trung tâm', 'Nếu cấu trúc cho phép, tìm cách phát triển và mở trung tâm khi vua họ chưa nhập thành. Phải tính cụ thể trước khi mở đường hoặc hy sinh; chưa nhập thành không đồng nghĩa vua yếu.'),
            'queen_early': ('Giả thuyết: phát triển quân kèm nhịp tấn công hậu', 'Tìm nước phát triển đồng thời đánh hậu nếu không mất tốt hoặc tụt nhịp. Đừng đuổi hậu bằng nhiều nước tốt vô ích; kiểm tra các ván dẫn chứng xem hậu ra sớm có thực sự bị khai thác không.'),
            'time_pressure': ('Giả thuyết: luyện quyết định trong thế phức tạp', 'Giữ thế cờ có lựa chọn phù hợp với khả năng tính của bạn và bảo toàn thời gian của chính mình. Không cố tạo hỗn loạn hoặc đi nhanh chỉ vì đối thủ từng xuống thấp đồng hồ.'),
        }
        for o in observations:
            if o['key'] in hypotheses and o['sample'] >= 15 and o['percent'] >= 50:
                title, text = hypotheses[o['key']]
                plan.append({'title': title, 'text': f'Căn cứ quan sát: {o["count"]}/{o["sample"]} ván đủ dữ liệu. ' + text + ' Đây là hướng cần thử, chưa phải kết luận điểm yếu.', 'evidence': o['evidence']})
    plan.append({'title': 'Luyện cho giải 20/11', 'text': 'Mỗi đối thủ chọn 1–2 nhánh phù hợp với hệ khai cuộc bạn đang dùng, 3 vị trí cần tự tính và vài ván tập đúng thời gian thi đấu. Ghi điều đã kiểm chứng và điều mới chỉ là giả thuyết; ưu tiên chất lượng quyết định của chính bạn.', 'evidence': []})
    now = int(time.time())
    report = {'version': VERSION, 'platform': platform, 'username': user, 'profile': profile or {'username': user}, 'filters': filters, 'generated_at': now, 'sample_until': until, 'summary': stats(accepted), 'by_color': [{'key': 'white', **stats(white)}, {'key': 'black', **stats(black)}], 'by_speed': group_stats(accepted, lambda g: g['speed']), 'openings': opening_rows, 'branches': sorted(branches, key=lambda x: (x['color'], x['ply'], -x['games'])), 'observations': observations, 'engine': {'evaluated_moves': evaluated, 'total_player_moves': sum(g['observations']['own_moves'] for g in accepted), 'games_with_evals': sum(g['observations']['evaluated_moves'] > 0 for g in accepted), 'games_with_local_evals': sum(g['observations'].get('local_evaluated_moves', 0) > 0 for g in accepted), 'errors': sorted(errors, key=lambda e: -e['win_percent_loss'])[:60], 'method': 'Dùng đánh giá có sẵn trong PGN và ưu tiên Stockfish local đã lưu ở bàn phân tích, theo phía Trắng. Chuyển centipawn sang phần trăm theo mô hình logistic. Độ sâu/engine nguồn có thể khác nhau; nước chưa đạt độ sâu hoặc so ở hai độ sâu khác nhau có nhãn ước tính. Chỉ dùng kết quả phân tích thường, không đọc dữ liệu két mã hóa.'}, 'plan': plan, 'warnings': warnings, 'acquisition': acquisition or {}, 'skipped': dict(skipped)}
    return report, accepted


def import_games(pgn):
    stream = io.StringIO(pgn); games = []
    while len(games) <= 1000:
        try:
            game = chess.pgn.read_game(stream)
        except (ValueError, IndexError):
            raise ValueError('Không đọc được PGN. Hãy xuất lại từ nền tảng.')
        if game is None:
            return games
        if game.errors:
            games.append({'pgn': ''})
            continue
        text = game.accept(chess.pgn.StringExporter(headers=True, variations=False, comments=True))
        games.append({'pgn': text, 'speed': speed_from_control(game.headers.get('TimeControl', '')), 'played_at': utc_timestamp(game.headers), 'rated': None})
    raise ValueError('Mỗi lần nhập tối đa 1.000 ván. Hãy tách bộ PGN nhỏ hơn.')
