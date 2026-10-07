"""Persistent local bot games, independent from imported platform games."""
from db import conn

SCHEMA = """
CREATE TABLE IF NOT EXISTS bot_games (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
 opponent TEXT NOT NULL, realm TEXT NOT NULL, user_color TEXT NOT NULL,
 result TEXT NOT NULL, reason TEXT NOT NULL, pgn TEXT NOT NULL, plies INTEGER NOT NULL
);
"""

def save(game):
    with conn() as c:
        c.executescript(SCHEMA)
        c.execute("""INSERT INTO bot_games(id, started_at, opponent, realm, user_color, result, reason, pgn, plies)
        VALUES(:id,:started_at,:opponent,:realm,:user_color,:result,:reason,:pgn,:plies)
        ON CONFLICT(id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP,
        result=excluded.result, reason=excluded.reason, pgn=excluded.pgn, plies=excluded.plies""", game)
    return {"saved": True, "id": game["id"]}

def listing(page=1, size=12):
    with conn() as c:
        c.executescript(SCHEMA)
        total = c.execute("SELECT COUNT(*) FROM bot_games").fetchone()[0]
        rows = c.execute("""SELECT id,started_at,updated_at,opponent,realm,user_color,result,reason,plies
        FROM bot_games ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?""", (size,(page-1)*size)).fetchall()
        return {"items":[dict(r) for r in rows], "total":total, "page":page}

def get(game_id):
    with conn() as c:
        c.executescript(SCHEMA)
        row = c.execute("SELECT * FROM bot_games WHERE id=?", (game_id,)).fetchone()
        return dict(row) if row else None
