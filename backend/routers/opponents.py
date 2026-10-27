"""Public chess preparation is isolated from the user's synchronized games and vault."""
import asyncio
import json
import re
import time
import zlib

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from db import conn
from services import opponents

router = APIRouter(prefix='/api/opponents', tags=['Chuẩn bị đối thủ'])
COLLECT_LOCK = asyncio.Lock()


class Options(BaseModel):
    model_config = ConfigDict(extra='forbid')
    platform: str = Field(pattern='^(chesscom|lichess)$')
    username: str = Field(min_length=2, max_length=200)
    days: int = Field(180, ge=7, le=730, strict=True)
    max_games: int = Field(300, ge=10, le=500, strict=True)
    speed: str = Field('all', pattern='^(all|bullet|blitz|rapid|classical|correspondence)$')
    rated_only: bool = True
    refresh: bool = False


class Imported(Options):
    pgn: str = Field(min_length=1, max_length=8 * 1024 * 1024)


class Edit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=120)
    notes: str = Field('', max_length=10000)


async def body(request, model, limit=16384):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > limit:
            raise HTTPException(413, 'Dữ liệu quá lớn. Mỗi bộ PGN tối đa 8 MB.')
    try:
        return model.model_validate_json(data)
    except ValidationError:
        raise HTTPException(422, 'Thông tin không hợp lệ. Kiểm tra nền tảng, nick, bộ lọc và giới hạn tệp.')


def normalize(options, source='public'):
    try:
        user = opponents.username(options.username, options.platform)
    except ValueError as e:
        raise HTTPException(422, str(e))
    filters = options.model_dump(include={'days', 'max_games', 'speed', 'rated_only'})
    filters['source'] = source
    if source == 'pgn':
        filters['rated_only'] = False  # PGN usually does not establish rated/casual status.
    return user, filters, opponents.report_id(options.platform, user, filters)


def row_for(id):
    if not re.fullmatch('[a-f0-9]{24}', id):
        raise HTTPException(422, 'Mã hồ sơ không hợp lệ.')
    with conn() as c:
        row = c.execute('SELECT * FROM opponent_reports WHERE id=?', (id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Không tìm thấy hồ sơ đã lưu.')
    return row


def decoded(row):
    return json.loads(zlib.decompress(row['games']))


def detail(row, cached=False):
    report = json.loads(row['report'])
    games = decoded(row)
    return {**report, 'id': row['id'], 'title': row['title'], 'notes': row['notes'], 'updated_at': row['updated_at'], 'cached': cached,
            'games': [{k: g[k] for k in ('id', 'url', 'white', 'black', 'color', 'outcome', 'result', 'speed', 'played_at', 'rating', 'opponent_rating', 'opening', 'plies')} for g in games]}


def store(id, platform, user, filters, report, games):
    now = int(time.time())
    with conn() as c:
        c.execute('INSERT INTO opponent_reports(id,platform,username,title,filters,report,games,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) '
                  'ON CONFLICT(id) DO UPDATE SET report=excluded.report,games=excluded.games,updated_at=excluded.updated_at',
                  (id, platform, user, user + ' · ' + ('Chess.com' if platform == 'chesscom' else 'Lichess'), json.dumps(filters), json.dumps(report, ensure_ascii=False), zlib.compress(json.dumps(games, ensure_ascii=False).encode()), now, now))
    return detail(row_for(id))


@router.get('')
def listing(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    with conn() as c:
        rows = c.execute('SELECT id,title,platform,username,filters,report,updated_at FROM opponent_reports ORDER BY updated_at DESC,id').fetchall()
    return [{'id': r['id'], 'title': r['title'], 'platform': r['platform'], 'username': r['username'], 'filters': json.loads(r['filters']), 'summary': json.loads(r['report'])['summary'], 'updated_at': r['updated_at']} for r in rows]


@router.post('/collect')
async def collect(request: Request, response: Response):
    options = await body(request, Options); user, filters, id = normalize(options)
    response.headers['Cache-Control'] = 'no-store'
    # Recheck inside the lock so simultaneous clicks do not duplicate downloads.
    async with COLLECT_LOCK:
        with conn() as c:
            existing = c.execute('SELECT * FROM opponent_reports WHERE id=?', (id,)).fetchone()
        if existing and not options.refresh:
            return detail(existing, cached=True)
        try:
            profile, raw, acquisition = await asyncio.wait_for(opponents.collect(options.platform, user, filters), timeout=180)
            report, games = await asyncio.to_thread(opponents.build_report, options.platform, user, filters, raw, profile, acquisition)
        except opponents.SourceError as e:
            raise HTTPException(e.status, str(e))
        except httpx.HTTPError:
            raise HTTPException(502, 'Chưa kết nối được nền tảng. Hồ sơ cũ vẫn còn; bạn có thể nhập PGN để tiếp tục.')
        except TimeoutError:
            raise HTTPException(504, 'Lượt tải đã quá ba phút. Hồ sơ cũ vẫn còn. Giảm số ván, thời gian hoặc nhập PGN để thử lại.')
        except (ValueError, KeyError, TypeError) as e:
            raise HTTPException(422, str(e) if isinstance(e, ValueError) else 'Dữ liệu nguồn chưa hợp lệ; hồ sơ cũ được giữ nguyên.')
        return store(id, options.platform, user, filters, report, games)


@router.post('/import')
async def import_pgn(request: Request, response: Response):
    options = await body(request, Imported, 8 * 1024 * 1024)
    user, filters, id = normalize(options, 'pgn'); response.headers['Cache-Control'] = 'no-store'
    try:
        raw = await asyncio.to_thread(opponents.import_games, options.pgn)
        report, games = await asyncio.to_thread(opponents.build_report, options.platform, user, filters, raw, None,
                                                {'source': 'PGN do người dùng nhập', 'scanned': len(raw), 'notes': ['PGN không luôn ghi ván rated/casual; bộ nhập không lọc trạng thái này. Không tự liên kết tài khoản giữa các nền tảng.']})
    except ValueError as e:
        raise HTTPException(422, str(e))
    return store(id, options.platform, user, filters, report, games)


@router.get('/{id}')
def get_report(id: str, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return detail(row_for(id), cached=True)


@router.post('/{id}/recalculate')
async def recalculate(id: str):
    row = row_for(id); old = json.loads(row['report']); games = decoded(row)
    report, games = await asyncio.to_thread(opponents.build_report, row['platform'], row['username'], old['filters'], games, old['profile'], old['acquisition'], old.get('sample_until', old['generated_at']))
    # Preserve the cohort date when incorporating new saved engine results.
    report['sample_until'] = old.get('sample_until', old['generated_at'])
    return store(id, row['platform'], row['username'], old['filters'], report, games)


@router.patch('/{id}')
async def edit(id: str, request: Request):
    row_for(id); data = await body(request, Edit, 50000)
    if not data.title.strip():
        raise HTTPException(422, 'Tên hồ sơ không được trống.')
    with conn() as c:
        c.execute('UPDATE opponent_reports SET title=?,notes=? WHERE id=?', (data.title.strip(), data.notes, id))
    return {'saved': True}


@router.delete('/{id}')
def remove(id: str):
    row_for(id)
    with conn() as c:
        c.execute('DELETE FROM opponent_reports WHERE id=?', (id,))
    return {'deleted': True}


@router.get('/{id}/games/{game_id}')
def get_game(id: str, game_id: str, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    for game in decoded(row_for(id)):
        if game['id'] == game_id:
            return {**game, 'user_color': 'w' if game['color'] == 'white' else 'b'}
    raise HTTPException(404, 'Không tìm thấy ván trong hồ sơ này.')


@router.get('/{id}/pgn')
def export_pgn(id: str):
    row = row_for(id)
    text = '\n\n'.join(g['pgn'] for g in decoded(row))
    return Response(text, media_type='application/x-chess-pgn', headers={'Content-Disposition': f'attachment; filename="{row["username"]}-preparation.pgn"', 'Cache-Control': 'no-store'})
