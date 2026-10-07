from fastapi import APIRouter
from db import conn
from services import sync, realm
router = APIRouter(prefix="/api")
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
                 page: int = Query(1, ge=1), size: int = Query(12, ge=1, le=50)):
    with conn() as c:
        c.executescript(bot_history.SCHEMA)
        sql = """
        SELECT 'bot' AS source,id,started_at,opponent,user_color,result,reason,plies FROM bot_games
        UNION ALL
        SELECT platform AS source,CAST(id AS TEXT),strftime('%Y-%m-%dT%H:%M:%SZ',played_at,'unixepoch'),
        opponent,CASE WHEN color='white' THEN 'w' ELSE 'b' END,
        CASE WHEN result='draw' THEN '1/2-1/2'
             WHEN (result='win' AND color='white') OR (result='loss' AND color='black') THEN '1-0'
             ELSE '0-1' END,
        time_class || ' · ' || CASE result WHEN 'win' THEN 'Thắng' WHEN 'loss' THEN 'Thua' ELSE 'Hòa' END,
        NULL FROM games WHERE platform IN ('chesscom','lichess')
        """
        where = "" if source == "all" else " WHERE source=?"
        args = () if source == "all" else (source,)
        total = c.execute("SELECT COUNT(*) FROM ("+sql+")"+where,args).fetchone()[0]
        rows = c.execute("SELECT * FROM ("+sql+")"+where+" ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?",
                         args+(size,(page-1)*size)).fetchall()
        return {"items":[dict(r) for r in rows],"total":total,"page":page}

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
