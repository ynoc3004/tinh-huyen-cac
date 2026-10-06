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
