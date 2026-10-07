from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from services import puzzles

router = APIRouter(prefix="/api/bi-canh")


@router.get("/status")
def status():
    return puzzles.status()


@router.get("/puzzle")
def puzzle(realm: str = Query("Luyện Khí", max_length=40), tier: int = Query(1, ge=1, le=9), bias: int = Query(0, ge=-400, le=400),
           theme: str = Query("", max_length=40, pattern=r"^[A-Za-z0-9]*$"), exclude: str = Query("", max_length=2000)):
    skip = {x for x in exclude.split(",") if x} | set(puzzles.recent_ids(120))
    p = puzzles.pick(realm, tier, bias, theme, skip)
    if p is None:
        raise HTTPException(404, "Kho câu đố đang trống.")
    return p


class Result(BaseModel):
    puzzle_id: str = Field(max_length=40)
    rating: int = Field(ge=0, le=4000)
    realm: str = Field("", max_length=40)
    solved: bool
    mistakes: int = Field(0, ge=0, le=200)
    hints: int = Field(0, ge=0, le=20)
    seconds: float = Field(0, ge=0, le=86400)


@router.post("/result")
def result(r: Result):
    puzzles.log_result(r.puzzle_id, r.rating, r.realm, r.solved, r.mistakes, r.hints, r.seconds)
    return puzzles.stats()


@router.get("/stats")
def stats():
    return puzzles.stats()

# Bot games are stored separately; they do not affect platform ratings.
from typing import Literal
from services import bot_history

class BotGame(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9-]+$")
    started_at: str = Field(min_length=1, max_length=40)
    opponent: str = Field(min_length=1, max_length=100)
    realm: str = Field("", max_length=40)
    user_color: Literal["w", "b"]
    result: Literal["*", "1-0", "0-1", "1/2-1/2"]
    reason: str = Field("", max_length=160)
    pgn: str = Field(max_length=200000)
    plies: int = Field(ge=0, le=10000)

@router.put("/bot-games")
def save_bot_game(game: BotGame):
    return bot_history.save(game.model_dump())

@router.get("/bot-games")
def list_bot_games(page: int = Query(1, ge=1), size: int = Query(12, ge=1, le=50)):
    return bot_history.listing(page, size)

@router.get("/bot-games/{game_id}")
def get_bot_game(game_id: str):
    game = bot_history.get(game_id)
    if game is None:
        raise HTTPException(404, "Không tìm thấy kỳ phổ.")
    return game
