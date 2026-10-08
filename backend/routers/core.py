from fastapi import APIRouter
from db import conn
from services import sync, realm
from datetime import date
from pydantic import BaseModel, Field
router = APIRouter(prefix="/api")

class CultivationProfile(BaseModel):
    full_name: str = Field("", max_length=120)
    dao_name: str = Field("", max_length=120)
    birth_date: date | None = None
    birth_time: str | None = Field(None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    hometown: str = Field("", max_length=200)
    goal: str = Field("", max_length=1000)
    notes: str = Field("", max_length=5000)

@router.get("/profile")
def get_profile():
    with conn() as c:
        row = c.execute("SELECT full_name,dao_name,birth_date,birth_time,hometown,goal,notes,updated_at "
                        "FROM cultivation_profile WHERE id=1").fetchone()
    return dict(row) if row else {**CultivationProfile().model_dump(), "updated_at": None}

@router.put("/profile")
def save_profile(profile: CultivationProfile):
    values = (profile.full_name.strip(), profile.dao_name.strip(),
              profile.birth_date.isoformat() if profile.birth_date else None, profile.birth_time,
              profile.hometown.strip(), profile.goal.strip(), profile.notes.strip())
    with conn() as c:
        c.execute("""INSERT INTO cultivation_profile(id,full_name,dao_name,birth_date,birth_time,hometown,goal,notes)
                     VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                     full_name=excluded.full_name,dao_name=excluded.dao_name,birth_date=excluded.birth_date,
                     birth_time=excluded.birth_time,hometown=excluded.hometown,goal=excluded.goal,
                     notes=excluded.notes,updated_at=CURRENT_TIMESTAMP""", values)
        row = c.execute("SELECT full_name,dao_name,birth_date,birth_time,hometown,goal,notes,updated_at "
                        "FROM cultivation_profile WHERE id=1").fetchone()
    return dict(row)

@router.post("/sync")
async def do_sync(): return {"new_games": await sync.sync_all()}
@router.get("/realm")
def get_realm():
    with conn() as c:
        rows = c.execute("""SELECT platform,time_class,rating,day FROM rating_history h WHERE day=(SELECT MAX(day) FROM rating_history
            WHERE platform=h.platform AND time_class=h.time_class) ORDER BY rating ASC""").fetchall()
    return realm.summary([dict(r) for r in rows])
@router.get("/games")
def games(limit: int = 50):
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT id,platform,played_at,color,opponent,my_rating,opp_rating,result,time_class FROM games ORDER BY played_at DESC LIMIT ?", (limit,))]

# Combined archive: imported games and local bot games share one replay view.
from fastapi import HTTPException, Query
from services import bot_history
from config import CHESSCOM_USER, LICHESS_USER

@router.get("/sync/accounts")
def sync_accounts():
    return {"chesscom": CHESSCOM_USER, "lichess": LICHESS_USER}

@router.get("/game-archive")
def game_archive(source: str = Query("all", pattern=r"^(all|bot|chesscom|lichess)$"),
                 page: int = Query(1, ge=1), size: int = Query(12, ge=1, le=50),
                 time_class: str = Query("all", pattern=r"^(all|bullet|blitz|rapid|other)$")):
    with conn() as c:
        c.executescript(bot_history.SCHEMA)
        sql = """
        SELECT 'bot' AS source,id,started_at,opponent,user_color,result,reason,plies,
        'other' AS time_class FROM bot_games
        UNION ALL
        SELECT platform AS source,CAST(id AS TEXT),strftime('%Y-%m-%dT%H:%M:%SZ',played_at,'unixepoch'),
        opponent,CASE WHEN color='white' THEN 'w' ELSE 'b' END,
        CASE WHEN result='draw' THEN '1/2-1/2'
             WHEN (result='win' AND color='white') OR (result='loss' AND color='black') THEN '1-0'
             ELSE '0-1' END,
        COALESCE(time_class,'Khác') || ' · ' || CASE result WHEN 'win' THEN 'Thắng' WHEN 'loss' THEN 'Thua' ELSE 'Hòa' END,
        NULL,CASE WHEN lower(trim(time_class)) IN ('bullet','blitz','rapid')
             THEN lower(trim(time_class)) ELSE 'other' END AS time_class
        FROM games WHERE platform IN ('chesscom','lichess')
        """
        clauses, args = [], []
        if source != "all":
            clauses.append("source=?")
            args.append(source)
        source_where = " WHERE " + " AND ".join(clauses) if clauses else ""
        counts = {key: 0 for key in ("all", "bullet", "blitz", "rapid", "other")}
        for row in c.execute("SELECT time_class,COUNT(*) AS n FROM ("+sql+")"+source_where+
                             " GROUP BY time_class", args):
            counts[row["time_class"]] = row["n"]
            counts["all"] += row["n"]
        if time_class != "all":
            clauses.append("time_class=?")
            args.append(time_class)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        total = counts[time_class]
        rows = c.execute("SELECT * FROM ("+sql+")"+where+" ORDER BY started_at DESC,source ASC,id DESC LIMIT ? OFFSET ?",
                         args+[size,(page-1)*size]).fetchall()
        return {"items":[dict(r) for r in rows],"total":total,"page":page,"size":size,"counts":counts}

@router.get("/game-archive/{source}/{game_id}")
def archive_game(source: str, game_id: str):
    if source == "bot":
        game = bot_history.get(game_id)
        if game:
            return game
    elif source in ("chesscom","lichess"):
        with conn() as c:
            row = c.execute("SELECT * FROM games WHERE platform=? AND id=?", (source,game_id)).fetchone()
        if row:
            g = dict(row)
            return {"pgn":g["pgn"] or "", "user_color":"w" if g["color"]=="white" else "b",
                    "opponent":g["opponent"],"result":g["result"],"reason":g["time_class"]}
    raise HTTPException(404,"Không tìm thấy kỳ phổ.")
