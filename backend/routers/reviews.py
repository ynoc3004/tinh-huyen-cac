"""Saved local-engine results. Vault PGNs stay encrypted and behind the vault guard."""
import io
import json
import math
import re
import time
import zlib
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from db import conn
from routers import library
from services import vault

router = APIRouter()
KEY = re.compile(r"^[0-9a-f]{64}$")
UCI = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")
MAX_BODY = 16 * 1024 * 1024


def identity(game_key, item_id=None):
    if not KEY.fullmatch(game_key):
        raise HTTPException(422, "Mã ván không hợp lệ")
    return f"library:{item_id}:{game_key}" if item_id is not None else f"import:{game_key}"


def valid_score(score, lines=False):
    if not isinstance(score, dict):
        return False
    cp, mate, winner, depth = (score.get(k) for k in ("cp", "mate", "mateWinner", "depth"))
    numeric = type(cp) in (int, float) and math.isfinite(cp) and mate is None and winner is None
    mating = cp is None and type(mate) is int and mate >= 0 and winner in ("w", "b")
    pv = score.get("pv")
    valid = (numeric or mating) and type(depth) is int and 0 <= depth <= 256 and isinstance(pv, list) and len(pv) <= 512 and all(isinstance(u, str) and UCI.fullmatch(u) for u in pv)
    if lines:
        variations = score.get("lines")
        return valid and type(score.get("limited")) is bool and isinstance(variations, list) and len(variations) <= 3 and all(valid_score(s) for s in variations)
    return valid


async def read_snapshot(request):
    # Bound the request before JSON parsing; no new analysis is run on the server.
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BODY:
            raise HTTPException(413, "Kết quả phân tích quá lớn")
    try:
        data = json.loads(raw)
        pgn, scores, played, plies = (data[k] for k in ("pgn", "scores", "playedScores", "plies"))
        if not isinstance(pgn, str) or not pgn.strip() or len(pgn.encode()) > 2 * 1024 * 1024:
            raise ValueError()
        if data["version"] != 2 or data["engine"] != "stockfish-19-lite" or data["quality"] not in (250, 750, 2000):
            raise ValueError()
        if type(plies) is not int or not 1 <= plies <= 10000 or not isinstance(scores, list) or not 1 <= len(scores) <= plies + 1:
            raise ValueError()
        if not isinstance(played, list) or not 0 <= len(played) <= min(plies, len(scores)):
            raise ValueError()
        if not all(valid_score(s, lines=True) for s in scores) or not all(valid_score(s) and type(s.get("limited")) is bool for s in played):
            raise ValueError()
        for name in ("white", "black", "result", "event"):
            if not isinstance(data.get(name, ""), str) or len(data.get(name, "")) > 1000:
                raise ValueError()
        # Reject non-finite JSON values anywhere, including auxiliary score fields.
        json.dumps(data, allow_nan=False)
    except (KeyError, ValueError, TypeError, UnicodeError, OverflowError):
        raise HTTPException(422, "Kết quả phân tích không hợp lệ")
    return data


def encode(data, key=None):
    raw = zlib.compress(json.dumps(data, ensure_ascii=False, allow_nan=False).encode())
    if key is None:
        return raw
    out = io.BytesIO()
    enc = vault.Encryptor(key, out)
    enc.write(raw)
    enc.finish()
    return out.getvalue()


def decode(raw, key=None):
    if key is not None:
        raw = b"".join(vault.decrypt_iter(key, io.BytesIO(raw)))
    return json.loads(zlib.decompress(raw))


def check_item(item_id):
    with conn() as c:
        row = c.execute("SELECT ext,blob,size FROM library_items WHERE id=?", (item_id,)).fetchone()
    if not row or not row["blob"] or (row["ext"] or "").lower() != ".pgn":
        raise HTTPException(404, "Không tìm thấy tài liệu PGN")
    if (row["size"] or 0) > 2 * 1024 * 1024:
        raise HTTPException(413, "PGN lớn hơn 2 MB")
    path = library._blob_dir() / Path(row["blob"]).name
    if not path.is_file():
        raise HTTPException(404, "Không tìm thấy tài liệu PGN")
    return path


def save(game_key, data, item_id=None, key=None):
    record_id = identity(game_key, item_id)
    data = {**data, "game_key": game_key, "updated": int(time.time() * 1000)}
    complete = len(data["scores"]) == data["plies"] + 1 and len(data["playedScores"]) == data["plies"]
    meta = {name: data.get(name, "") for name in ("white", "black", "event", "result")}
    meta.update(game_key=game_key, item_id=item_id, updated=data["updated"], quality=data["quality"], plies=data["plies"], analyzed=len(data["playedScores"]), complete=complete)
    with conn() as c:
        c.execute("INSERT INTO saved_reviews(id,game_key,item_id,metadata,payload,updated_at) VALUES(?,?,?,?,?,?) "
                  "ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,payload=excluded.payload,updated_at=excluded.updated_at",
                  (record_id, game_key, item_id, encode(meta, key), encode(data, key), data["updated"]))
    return {"saved": True, **meta}


def listing(response, protected=False, key=None):
    response.headers["Cache-Control"] = "no-store"
    with conn() as c:
        rows = c.execute("SELECT metadata,item_id FROM saved_reviews WHERE item_id IS " + ("NOT NULL" if protected else "NULL") + " ORDER BY updated_at DESC").fetchall()
    items = []
    for row in rows:
        try:
            if protected:
                check_item(row["item_id"])
            items.append(decode(row["metadata"], key))
        except (ValueError, zlib.error, HTTPException):
            # A different linked vault or deleted blob must not expose an old entry.
            continue
    return {"items": items}


def detail(game_key, response, item_id=None, key=None):
    record_id = identity(game_key, item_id)
    response.headers["Cache-Control"] = "no-store"
    if item_id is not None:
        check_item(item_id)
    with conn() as c:
        row = c.execute("SELECT payload FROM saved_reviews WHERE id=?", (record_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Ván này chưa có kết quả đã lưu")
    try:
        return decode(row["payload"], key)
    except (ValueError, zlib.error):
        raise HTTPException(409, "Không đọc được kết quả đã lưu")


@router.get("/api/reviews")
def list_public(response: Response):
    return listing(response)


@router.get("/api/reviews/{game_key}")
def get_public(game_key: str, response: Response):
    return detail(game_key, response)


@router.put("/api/reviews/{game_key}")
async def save_public(game_key: str, request: Request):
    identity(game_key)
    return save(game_key, await read_snapshot(request))


@router.get("/api/library/reviews")
def list_protected(response: Response, key: bytes = Depends(library.guard)):
    return listing(response, protected=True, key=key)


@router.get("/api/library/reviews/{item_id}/{game_key}")
def get_protected(item_id: int, game_key: str, response: Response, key: bytes = Depends(library.guard)):
    return detail(game_key, response, item_id, key)


@router.put("/api/library/reviews/{item_id}/{game_key}")
async def save_protected(item_id: int, game_key: str, request: Request, key: bytes = Depends(library.guard)):
    identity(game_key, item_id)
    path = check_item(item_id)
    data = await read_snapshot(request)
    try:
        with path.open("rb") as f:
            original = b"".join(vault.decrypt_iter(key, f)).decode("utf-8-sig").strip()
    except (ValueError, UnicodeError):
        raise HTTPException(409, "Không đọc được tài liệu gốc")
    if data["pgn"].lstrip("\ufeff").strip() != original:
        raise HTTPException(409, "Kỳ phổ đã thay đổi. Hãy mở lại tài liệu")
    return save(game_key, data, item_id, key)
