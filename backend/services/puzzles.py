"""Bí cảnh: kho câu đố, chọn câu theo cảnh giới, nhật ký giải và nạp kho từ file CSV của Lichess."""
import csv
import io
import json
import os
import random
import sqlite3
from pathlib import Path

import config
from db import conn as app_conn

# Dải điểm câu đố của từng cảnh giới (chồng nhau một chút để chuyển cảnh giới không bị nhảy vọt)
REALM_BANDS = {
    "Phàm Nhân": (400, 950),
    "Luyện Khí": (800, 1350),
    "Trúc Cơ": (1200, 1700),
    "Kim Đan": (1500, 2000),
    "Nguyên Anh": (1800, 2350),
    "Hóa Thần": (2100, 3000),
}
DEFAULT_BAND = REALM_BANDS["Luyện Khí"]
MAIN_THEMES = ["mate", "fork", "pin", "skewer", "discoveredAttack", "doubleCheck", "sacrifice", "deflection", "attraction", "trappedPiece",
               "hangingPiece", "capturingDefender", "quietMove", "defensiveMove", "intermezzo", "backRankMate", "smotheredMate",
               "kingsideAttack", "exposedKing", "promotion", "zugzwang", "endgame"]
_status_memo = {}
SAMPLE_FILE = Path(__file__).with_name("sample_puzzles.json")
URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"


def band_for(realm):
    return REALM_BANDS.get(realm, DEFAULT_BAND)


def target_rating(realm, tier=1, bias=0, rng=random):
    """Điểm câu đố nhắm tới: nền theo tầng trong cảnh giới, dao động ngẫu nhiên và độ lệch thích nghi từ phía người chơi."""
    lo, hi = band_for(realm)
    tier = max(1, min(9, int(tier or 1)))
    base = lo + (tier - 1) / 8 * (hi - lo)
    bias = max(-250, min(250, int(bias or 0)))
    r = base + rng.uniform(-120, 120) + bias
    return int(max(300, lo - 150, min(3200, hi + 150, r)))


# ---------- đọc kho ----------
def _open_db():
    p = Path(config.PUZZLE_DB)
    if not p.is_file():
        return None
    c = sqlite3.connect(p)
    c.row_factory = sqlite3.Row
    try:
        if c.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0] == 0:
            c.close()
            return None
    except sqlite3.Error:
        c.close()
        return None
    return c


def _sample():
    return json.loads(SAMPLE_FILE.read_text(encoding="utf-8"))


def _shape(row, source, target, band):
    themes = row["themes"]
    return {
        "id": row["id"], "fen": row["fen"], "moves": str(row["moves"]).split() if isinstance(row["moves"], str) else list(row["moves"]),
        "rating": int(row["rating"]), "themes": str(themes).split(), "popularity": int(row["popularity"] or 0),
        "url": f"https://lichess.org/training/{row['id']}" if source == "lichess" else "",
        "source": source, "target": target, "band": list(band),
    }


def pick(realm, tier=1, bias=0, theme="", exclude=(), rng=random):
    """Chọn một câu đố. Trả về dict hoặc None."""
    band = band_for(realm)
    target = target_rating(realm, tier, bias, rng)
    exclude = set(exclude)
    db = _open_db()
    if db is None:
        pool = [p for p in _sample() if p["id"] not in exclude and (not theme or theme in p["themes"].split())]
        if not pool:
            pool = [p for p in _sample() if p["id"] not in exclude] or _sample()
        pool.sort(key=lambda p: abs(p["rating"] - target))
        return _shape(rng.choice(pool[:3]), "mau", target, band)
    try:
        like = f"% {theme} %" if theme else "%"
        for w in (40, 80, 150, 300, 600, 1200):
            rows = db.execute(
                "SELECT * FROM puzzles WHERE rating BETWEEN ? AND ? AND themes LIKE ? ORDER BY RANDOM() LIMIT 40",
                (target - w, target + w, like)).fetchall()
            rows = [r for r in rows if r["id"] not in exclude]
            if rows:
                return _shape(rng.choice(rows), "lichess", target, band)
        if theme:  # chủ đề này không có câu nào gần mức điểm: bỏ lọc chủ đề
            return pick(realm, tier, bias, "", exclude, rng)
        return None
    finally:
        db.close()


def status():
    db = _open_db()
    if db is None:
        return {"count": len(_sample()), "sample": True, "themes": {}}
    try:
        st = Path(config.PUZZLE_DB).stat()
        key = (str(config.PUZZLE_DB), st.st_mtime_ns, st.st_size)
        if key not in _status_memo:  # đếm theo chủ đề khá tốn, chỉ làm lại khi kho đổi
            n = db.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0]
            themes = {t: db.execute("SELECT COUNT(*) FROM puzzles WHERE themes LIKE ?", (f"% {t} %",)).fetchone()[0] for t in MAIN_THEMES}
            _status_memo.clear()
            _status_memo[key] = {"count": n, "sample": False, "themes": themes}
        return _status_memo[key]
    finally:
        db.close()


# ---------- nhật ký ----------
def log_result(puzzle_id, rating, realm, solved, mistakes=0, hints=0, seconds=0.0):
    with app_conn() as c:
        c.execute("INSERT INTO puzzle_log(puzzle_id, rating, realm, solved, mistakes, hints, seconds) VALUES(?,?,?,?,?,?,?)",
                  (puzzle_id, int(rating), realm, 1 if solved else 0, int(mistakes), int(hints), float(seconds)))


def recent_ids(limit=300):
    with app_conn() as c:
        return [r["puzzle_id"] for r in c.execute("SELECT puzzle_id FROM puzzle_log ORDER BY id DESC LIMIT ?", (limit,))]


def stats():
    with app_conn() as c:
        today = c.execute("SELECT COUNT(*) n FROM puzzle_log WHERE solved=1 AND date(at,'localtime')=date('now','localtime')").fetchone()["n"]
        total = c.execute("SELECT COUNT(*) n FROM puzzle_log WHERE solved=1").fetchone()["n"]
        days = {r["d"] for r in c.execute("SELECT DISTINCT date(at,'localtime') d FROM puzzle_log WHERE solved=1")}
        recent = [bool(r["solved"]) for r in c.execute("SELECT solved FROM puzzle_log ORDER BY id DESC LIMIT 12")]
        now = c.execute("SELECT date('now','localtime') d").fetchone()["d"]
    import datetime
    day = datetime.date.fromisoformat(now)
    if day.isoformat() not in days:
        day -= datetime.timedelta(days=1)  # hôm nay chưa giải thì chuỗi vẫn giữ tới hết hôm nay
    streak = 0
    while day.isoformat() in days:
        streak += 1
        day -= datetime.timedelta(days=1)
    return {"today": today, "total": total, "streak": streak, "recent": recent[::-1]}


# ---------- nạp kho từ CSV Lichess ----------
def _open_text(path):
    path = Path(path)
    if path.suffix == ".zst":
        try:
            import zstandard
        except ImportError:
            raise SystemExit("File .zst cần thư viện zstandard. Chạy: pip install zstandard")
        raw = open(path, "rb")
        return io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw), encoding="utf-8", newline="")
    return open(path, encoding="utf-8", newline="")


def import_csv(path, per_bucket=1500, min_pop=80, min_plays=250, progress=None, rng=None):
    """Lọc kho Lichess (hàng triệu câu) xuống vài chục nghìn câu chất lượng, mỗi khoảng 50 điểm giữ tối đa per_bucket câu."""
    rng = rng or random.Random(7)
    buckets, seen, rows_read = {}, {}, 0
    with _open_text(path) as f:
        for row in csv.DictReader(f):
            rows_read += 1
            if progress and rows_read % 500000 == 0:
                progress(rows_read)
            try:
                rating, pop, plays = int(row["Rating"]), int(row["Popularity"]), int(row["NbPlays"])
            except (KeyError, ValueError):
                continue
            hard = rating >= 2200  # câu rất khó ít người chơi, nới ngưỡng
            if pop < (60 if hard else min_pop) or plays < (60 if hard else min_plays):
                continue
            b = rating // 50
            seen[b] = seen.get(b, 0) + 1
            lst = buckets.setdefault(b, [])
            rec = (row["PuzzleId"], row["FEN"], row["Moves"], rating, pop, plays, " " + row["Themes"].strip() + " ", row.get("GameUrl", ""))
            if len(lst) < per_bucket:
                lst.append(rec)
            else:
                j = rng.randrange(seen[b])
                if j < per_bucket:
                    lst[j] = rec
    if rows_read == 0 or not buckets:
        raise ValueError("Không đọc được câu đố nào. Kiểm tra file có đúng là lichess_db_puzzle.csv không.")
    dest = Path(config.PUZZLE_DB)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    if tmp.exists():
        tmp.unlink()
    c = sqlite3.connect(tmp)
    c.execute("CREATE TABLE puzzles(id TEXT PRIMARY KEY, fen TEXT, moves TEXT, rating INT, popularity INT, plays INT, themes TEXT, url TEXT)")
    n = 0
    for lst in buckets.values():
        c.executemany("INSERT OR IGNORE INTO puzzles VALUES(?,?,?,?,?,?,?,?)", lst)
        n += len(lst)
    c.execute("CREATE INDEX idx_puzzles_rating ON puzzles(rating)")
    c.commit()
    c.close()
    os.replace(tmp, dest)
    return {"rows_read": rows_read, "kept": n, "buckets": len(buckets)}


def download(dest, progress=None):
    import httpx
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with httpx.stream("GET", URL, follow_redirects=True, timeout=60, headers=config.UA) as r:
        r.raise_for_status()
        done = 0
        with open(tmp, "wb") as out:
            for chunk in r.iter_bytes(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, int(r.headers.get("content-length") or 0))
    os.replace(tmp, dest)
    return dest
