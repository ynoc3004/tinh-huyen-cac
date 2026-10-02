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
