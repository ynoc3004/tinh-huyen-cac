import json, datetime, httpx
from config import UA, CHESSCOM_USER, LICHESS_USER
from db import conn
async def _get(cl, url, **kwargs):
    response = await cl.get(url, **kwargs)
    response.raise_for_status()
    return response


DRAWS = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}
async def sync_chesscom(c, cl):
    u = CHESSCOM_USER
    if not u: return 0
    day = datetime.date.today().isoformat()
    stats = (await _get(cl, f"https://api.chess.com/pub/player/{u}/stats")).json()
    for k, v in stats.items():
        if k.startswith("chess_") and "last" in v:
            c.execute("INSERT OR REPLACE INTO rating_history(platform,time_class,day,rating) VALUES('chesscom',?,?,?)",
                      (k[6:], day, v["last"]["rating"]))
    archives = (await _get(cl, f"https://api.chess.com/pub/player/{u}/games/archives")).json().get("archives", [])[-2:]
    n = 0
    for url in archives:
        for g in (await _get(cl, url)).json().get("games", []):
            w = g["white"]["username"].lower() == u.lower()
            me, op = g["white" if w else "black"], g["black" if w else "white"]
            res = "win" if me["result"] == "win" else ("draw" if me["result"] in DRAWS else "loss")
            n += c.execute("INSERT OR IGNORE INTO games(platform,ext_id,played_at,color,opponent,my_rating,opp_rating,result,time_class,pgn)"
                           " VALUES('chesscom',?,?,?,?,?,?,?,?,?)", (g["url"], g.get("end_time"), "white" if w else "black",
                           op["username"], me["rating"], op["rating"], res, g["time_class"], g.get("pgn"))).rowcount
    return n
async def sync_lichess(c, cl):
    u = LICHESS_USER
    if not u: return 0
    day = datetime.date.today().isoformat()
    for k, v in (await _get(cl, f"https://lichess.org/api/user/{u}")).json().get("perfs", {}).items():
        if v.get("games", 0) > 0 and "rating" in v:
            c.execute("INSERT OR REPLACE INTO rating_history(platform,time_class,day,rating) VALUES('lichess',?,?,?)", (k, day, v["rating"]))
    r = await _get(cl, f"https://lichess.org/api/games/user/{u}", params={"max": 100, "pgnInJson": "true"},
                     headers={**UA, "Accept": "application/x-ndjson"})
    n = 0
    for line in r.text.splitlines():
        if not line.strip():
            continue
        g = json.loads(line)
        if g.get("status") not in {"mate", "resign", "stalemate", "timeout", "draw", "outoftime", "cheat", "variantEnd"}:
            continue
        p = g["players"]
        w = p["white"].get("user", {}).get("name", "").lower() == u.lower()
        me, op = p["white" if w else "black"], p["black" if w else "white"]
        win = g.get("winner")
        res = "draw" if not win else ("win" if (win == "white") == w else "loss")
        n += c.execute("INSERT OR IGNORE INTO games(platform,ext_id,played_at,color,opponent,my_rating,opp_rating,result,time_class,pgn)"
                       " VALUES('lichess',?,?,?,?,?,?,?,?,?)", (g["id"], g["createdAt"] // 1000, "white" if w else "black",
                       op.get("user", {}).get("name", "AI"), me.get("rating"), op.get("rating"), res, g["speed"], g.get("pgn"))).rowcount
    return n
async def sync_all():
    async with httpx.AsyncClient(headers=UA, timeout=60, follow_redirects=True) as cl:
        result, errors = {}, {}
        for platform, fetch in (("chesscom", sync_chesscom), ("lichess", sync_lichess)):
            try:
                with conn() as c:
                    result[platform] = await fetch(c, cl)
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                result[platform] = 0
                errors[platform] = "Không thể đồng bộ nền tảng này; hãy kiểm tra username hoặc thử lại sau"
        if errors:
            result["errors"] = errors
        return result
