"""Teacher-authored worksheets. Difficulty bands are puzzle ratings, not student Elo/Steps."""
import json
import gzip
import random
import re
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Literal

import chess
import chess.svg
from pydantic import BaseModel, Field, model_validator

import config
from services.worksheet_themes import THEMES, grouped_themes, theme_field, theme_keys

LEVELS = [
    {"id": "beginner", "name": "Mới bắt đầu", "min": 400, "max": 899},
    {"id": "basic", "name": "Cơ bản", "min": 900, "max": 1299},
    {"id": "intermediate", "name": "Trung cấp", "min": 1300, "max": 1799},
    {"id": "advanced", "name": "Nâng cao", "min": 1800, "max": 2600},
]


class Filters(BaseModel):
    min_rating: int = Field(default=400, ge=0, le=4000)
    max_rating: int = Field(default=899, ge=0, le=4000)
    theme: str = Field(default="", max_length=80)

    @model_validator(mode="after")
    def band(self):
        if self.min_rating > self.max_rating:
            raise ValueError("Điểm thấp nhất phải nhỏ hơn hoặc bằng điểm cao nhất")
        if self.theme not in THEMES:
            raise ValueError("Chủ đề không được hỗ trợ")
        return self


class Exercise(BaseModel):
    id: str = Field(default="custom", max_length=80)
    fen: str = Field(min_length=1, max_length=150)
    instruction: str = Field(default="Tìm nước đi tốt nhất.", max_length=90)
    solution: str = Field(default="", max_length=500)
    rating: int | None = Field(default=None, ge=0, le=4000)
    source: Literal["custom", "lichess", "sample"] = "custom"
    themes: list[str] = Field(default_factory=list, max_length=30)
    opening_tags: list[str] = Field(default_factory=list, max_length=20)


class Document(BaseModel):
    title: str = Field(default="BÀI TẬP CỜ VUA", min_length=1, max_length=120)
    kind: Literal["exercise", "test"] = "exercise"
    level: str = Field(default="", max_length=60)
    instructions: str = Field(default="Ghi nước đi hoặc phương án vào dòng bên dưới mỗi thế cờ.", max_length=200)
    duration: int | None = Field(default=None, ge=1, le=240)
    rotate: bool = False
    show_prompts: bool = True
    header_text: str | None = Field(default=None, max_length=120)
    footer_text: str | None = Field(default=None, max_length=120)
    show_page_numbers: bool = True
    page_number_format: str = Field(default="Trang {page} / {total}", max_length=80)
    logo: str | None = Field(default=None, max_length=1_500_000)
    filters: Filters = Field(default_factory=Filters)
    exercises: list[Exercise] = Field(default_factory=list, max_length=120)

    @model_validator(mode="after")
    def nonblank_title(self):
        if not self.title.strip():
            raise ValueError("Tiêu đề không được trống")
        return self


class Selection(Filters):
    count: int = Field(default=12, ge=1, le=120)
    exclude: list[str] = Field(default_factory=list, max_length=120)


class Generation(BaseModel):
    document_id: str
    request_id: str
    document: Document
    selection: Selection
    mode: Literal["generate", "append", "replace"] = "generate"
    index: int | None = Field(default=None, ge=0, le=119)


class Edit(BaseModel):
    document_id: str
    document: Document
    exercise: Exercise
    index: int | None = Field(default=None, ge=0, le=119)


def clean_text(value):
    # Avoid control characters and normalize combining Vietnamese accents for PDF fonts.
    import unicodedata
    return unicodedata.normalize("NFC", " ".join(value.split()))


def board_from_fen(fen):
    try:
        board = chess.Board(fen.strip())
    except ValueError as exc:
        raise ValueError("FEN không hợp lệ") from exc
    if not board.is_valid():
        raise ValueError("Thế cờ không hợp lệ: kiểm tra hai vua, lượt đi, quân tốt và quyền nhập thành")
    if board.is_checkmate() or board.is_stalemate():
        raise ValueError("Thế cờ đã kết thúc; hãy chọn vị trí còn nước đi")
    return board


def validate_exercise(exercise):
    board = board_from_fen(exercise.fen)
    data = exercise.model_dump()
    data["fen"] = board.fen()
    data["instruction"] = clean_text(exercise.instruction) or "Tìm nước đi tốt nhất."
    tokens = re.sub(r"\d+\.(?:\.\.)?", " ", exercise.solution).split()
    if len(tokens) > 32:
        raise ValueError("Đáp án tối đa 32 nước đi")
    san = []
    start = board.copy()
    for token in tokens:
        try:
            move = board.parse_uci(token) if re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", token) else board.parse_san(token)
            san.append(board.san(move))
            board.push(move)
        except ValueError as exc:
            raise ValueError(f"Nước đáp án '{token}' không hợp lệ tại nước {len(san) + 1}") from exc
    data["solution"] = " ".join(san)
    data["turn"] = "w" if start.turn else "b"
    return data


def validate_document(document, exporting=False):
    if exporting and (not document.exercises or len(document.exercises) % 12):
        raise ValueError("Mỗi trang cần đúng 12 bài. Hãy thêm đủ 12, 24, 36… bài trước khi xuất PDF.")
    data = document.model_dump()
    for field in ("title", "level", "instructions", "header_text", "footer_text", "page_number_format"):
        if data[field] is not None:
            data[field] = clean_text(data[field])
    if data["logo"]:
        from services.worksheet_logo import validate_logo
        data["logo"] = validate_logo(data["logo"])
    data["exercises"] = []
    for i, exercise in enumerate(document.exercises, 1):
        try:
            data["exercises"].append(validate_exercise(exercise))
        except ValueError as exc:
            raise ValueError(f"Bài {i}: {exc}") from exc
    return data


def board_svg(exercise, rotate=False):
    board = chess.Board(exercise["fen"])
    orientation = board.turn if rotate else chess.WHITE
    svg = chess.svg.board(board, orientation=orientation, size=360, coordinates=True,
                          colors={"square light": "#ffffff", "square dark": "#d9d9d9", "margin": "#ffffff", "coord": "#333333"})
    # Outline the 8x8 playing area, leaving coordinate labels outside the frame.
    return svg.replace('</svg>', '<rect x="15" y="15" width="360" height="360" fill="none" '
                       'stroke="#333333" stroke-width="2"/></svg>')


@lru_cache(maxsize=1)
def starter_bank():
    with gzip.open(Path(__file__).with_name("worksheet_puzzles.json.gz"),"rt",encoding="utf-8") as stream:
        return json.load(stream)


def bank_info():
    path = Path(config.PUZZLE_DB)
    if path.is_file():
        try:
            with sqlite3.connect(path) as db:
                count = db.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0]
                if count:
                    return {"source": "local", "count": count, "name": "Kho Lichess đã nhập"}
        except sqlite3.Error:
            pass
    return {"source": "starter", "count": len(starter_bank()), "name": "Kho Lichess đi kèm"}


@lru_cache(maxsize=16)
def _theme_counts(path, modified, size, minimum, maximum):
    from collections import Counter
    counts = Counter()
    opening_tags_available = True
    if path:
        with sqlite3.connect(path) as db:
            columns = {row[1] for row in db.execute("PRAGMA table_info(puzzles)")}
            opening_tags_available = "opening_tags" in columns
            openings = "COALESCE(opening_tags,'')" if "opening_tags" in columns else "''"
            rows = db.execute(f"SELECT themes,{openings},COUNT(*) FROM puzzles WHERE rating BETWEEN ? AND ? "
                              f"GROUP BY themes,{openings}", (minimum, maximum))
            for themes, tags, count in rows:
                counts[""] += count
                for key in theme_keys(themes or "", tags):
                    if key in THEMES:
                        counts[key] += count
    else:
        for row in starter_bank():
            if minimum <= row['rating'] <= maximum:
                counts[""] += 1
                for key in theme_keys(row['themes'], row.get('opening_tags', '')):
                    if key in THEMES:
                        counts[key] += 1
    return {"counts": {key: counts[key] for key in THEMES}, "opening_tags_available": opening_tags_available}


def theme_counts(filters):
    info = bank_info()
    if info['source'] == 'local':
        path = Path(config.PUZZLE_DB)
        stat = path.stat()
        key = (str(path), stat.st_mtime_ns, stat.st_size)
    else:
        key = ('', 0, 0)
    return {**_theme_counts(*key, filters.min_rating, filters.max_rating), "bank": info,
            "min_rating": filters.min_rating, "max_rating": filters.max_rating}


def select_exercises(selection):
    info = bank_info()
    excluded = set(selection.exclude)
    field, theme = theme_field(selection.theme)
    if info["source"] == "local":
        with sqlite3.connect(config.PUZZLE_DB) as db:
            db.row_factory = sqlite3.Row
            columns = {row[1] for row in db.execute("PRAGMA table_info(puzzles)")}
            if field not in columns:
                raise ValueError("Kho đã nhập chưa có nhãn khai cuộc. Nhập lại file Lichess bằng import_puzzles.py để bổ sung; đề đang mở được giữ nguyên.")
            # Indexed rating range; bounded sample, exact theme tokens, no widening.
            rows = [dict(r) for r in db.execute(
                f"SELECT * FROM puzzles WHERE rating BETWEEN ? AND ? AND "
                f"(?='' OR instr(' '||trim({field})||' ', ' '||?||' ')>0) ORDER BY RANDOM() LIMIT 1500",
                (selection.min_rating, selection.max_rating, theme, theme))]
    else:
        rows = [p for p in starter_bank() if selection.min_rating <= p["rating"] <= selection.max_rating
                and (not theme or theme in p.get(field, '').split())]
    random.SystemRandom().shuffle(rows)
    result, seen = [], set()
    for row in rows:
        if row["id"] in excluded:
            continue
        try:
            board = board_from_fen(row["fen"])
            moves = row["moves"].split() if isinstance(row["moves"], str) else row["moves"]
            if len(moves) < 2:
                continue
            # Lichess FEN precedes the opponent's setup move; solution starts at move 2.
            board.push_uci(moves[0])
            themes = row["themes"].split()
            instruction = next((f"Chiếu hết trong {n} nước." for n in (1, 2, 3, 4) if f"mateIn{n}" in themes),
                               "Tìm phương án chiếu hết." if 'mate' in themes else "Tìm nước đi tốt nhất.")
            item = Exercise(id=row["id"], fen=board.fen(), solution=" ".join(moves[1:]), instruction=instruction,
                            rating=row["rating"], source="lichess", themes=row["themes"].split(),
                            opening_tags=(row.get('opening_tags') or '').split())
            shaped = validate_exercise(item)
            position = " ".join(shaped["fen"].split()[:4])
            if position in seen:
                continue
            seen.add(position)
            result.append(shaped)
            if len(result) == selection.count:
                return result
        except (ValueError, KeyError):
            continue
    raise ValueError(f"Chỉ tìm được {len(result)} bài hợp lệ trong bộ lọc này, cần {selection.count}. Giảm số trang, đổi chủ đề hoặc nhập thêm kho Lichess; ứng dụng không tự tăng độ khó hay lặp bài.")
