import random
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from db import conn
from services import pairing
from config import ADMIN_PASSWORD

router = APIRouter(prefix="/api")
NAMES = ["Thiên", "Địa", "Huyền", "Hoàng", "Vũ", "Trụ", "Hồng", "Hoang"]


class Student(BaseModel):
    name: str
    rating: int | None = None
    club: str | None = None


@router.post("/students")
def add_students(items: list[Student], allow_duplicates: bool = False):
    added_ids, duplicates = [], []
    with conn() as c:
        for s in items:
            name = s.name.strip()
            club = (s.club or "").strip() or None
            if not name:
                raise HTTPException(400, "Tên học viên không được trống")
            matches = c.execute("SELECT id FROM students WHERE name=? AND IFNULL(club,'')=IFNULL(?,'')", (name, club)).fetchall()
            if matches and not allow_duplicates:
                duplicates.append({"name": name, "club": club, "student_ids": [r["id"] for r in matches]})
                continue
            added_ids.append(c.execute("INSERT INTO students(name,rating,club) VALUES(?,?,?)", (name, s.rating, club)).lastrowid)
    return {"added": len(added_ids), "skipped": len(duplicates), "student_ids": added_ids, "duplicates": duplicates}



@router.get("/students")
def students():
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM students ORDER BY name")]


class NewTour(BaseModel):
    name: str
    date: str | None = None
    group_count: int | None = Field(default=None, ge=1)
    group_size: int | None = Field(default=None, ge=1)
    split_mode: str = "random"  # random | seeded
    format: str = "round_robin"  # round_robin | swiss
    student_ids: list[int] | None = None


@router.post("/tournaments")
def create(b: NewTour):
    fmt = b.format if b.format in ("round_robin", "swiss") else "round_robin"
    with conn() as c:
        if b.student_ids is not None:
            b.student_ids = _student_ids(c, b.student_ids)
            if not b.student_ids:
                raise HTTPException(400, "Chưa chọn học viên")
        rows = c.execute(
            "SELECT id,rating FROM students"
            if not b.student_ids
            else f"SELECT id,rating FROM students WHERE id IN ({','.join('?' * len(b.student_ids))})",
            b.student_ids or [],
        ).fetchall()
        if not rows:
            raise HTTPException(400, "Chưa có học viên")
        n = b.group_count or max(1, round(len(rows) / (b.group_size or 8)))
        if n > len(rows):
            raise HTTPException(400, "Số bảng nhiều hơn số người")
        seed = random.randrange(1 << 31)
        t = c.execute(
            "INSERT INTO tournaments(name,date,seed,split_mode) VALUES(?,?,?,?)",
            (b.name, b.date, seed, b.split_mode),
        ).lastrowid
        st = c.execute(
            "INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,1,'Vòng bảng',?)",
            (t, fmt),
        ).lastrowid
        out = []
        for i, ids in enumerate(
            pairing.split_groups([(r["id"], r["rating"]) for r in rows], n, b.split_mode, seed)
        ):
            g = c.execute(
                "INSERT INTO groups(stage_id,name) VALUES(?,?)",
                (st, NAMES[i] if n <= len(NAMES) else f"Bảng {i + 1}"),
            ).lastrowid
            for sid in ids:
                c.execute("INSERT INTO tournament_players VALUES(?,?,?)", (t, sid, g))
            out.append(
                {
                    "group_id": g,
                    "name": NAMES[i] if n <= len(NAMES) else f"Bảng {i + 1}",
                    "student_ids": ids,
                }
            )
    return {"tournament_id": t, "seed": seed, "format": fmt, "groups": out}


def _student_ids(c, ids):
    ids = list(dict.fromkeys(ids or []))
    known = {r["id"] for r in c.execute("SELECT id FROM students")}
    if not set(ids) <= known:
        raise HTTPException(400, "Có học viên không tồn tại")
    return ids


class Move(BaseModel):
    student_id: int
    group_id: int


@router.post("/tournaments/{tid}/move")
def move(tid: int, b: Move):
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        source = c.execute("SELECT group_id FROM tournament_players WHERE tournament_id=? AND student_id=?", (tid, b.student_id)).fetchone()
        if not source:
            raise HTTPException(404, "Học viên không nằm trong giải")
        if not c.execute("SELECT 1 FROM groups g JOIN stages s ON s.id=g.stage_id WHERE g.id=? AND s.tournament_id=? AND s.ord=1", (b.group_id, tid)).fetchone():
            raise HTTPException(400, "Bảng đích không thuộc vòng bảng của giải")
        if c.execute("SELECT 1 FROM pairings WHERE group_id IN (?,?)", (source["group_id"], b.group_id)).fetchone():
            raise HTTPException(409, "Chỉ chuyển bảng trước khi ghép cặp")
        c.execute(
            "UPDATE tournament_players SET group_id=? WHERE tournament_id=? AND student_id=?",
            (b.group_id, tid, b.student_id),
        )
    return {"ok": True}


@router.get("/tournaments/{tid}")
def get_tour(tid: int):
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        gs = c.execute(
            "SELECT g.id,g.name,s.ord,s.format FROM groups g JOIN stages s ON s.id=g.stage_id "
            "WHERE s.tournament_id=? ORDER BY g.id",
            (tid,),
        ).fetchall()
        return {
            **dict(t),
            "groups": [
                {
                    **dict(g),
                    "players": [
                        dict(r)
                        for r in c.execute(
                            "SELECT s.id,s.name,s.rating FROM students s WHERE s.id IN "
                            "(SELECT student_id FROM tournament_players WHERE group_id=? "
                            "UNION SELECT student_id FROM stage_players WHERE group_id=?)",
                            (g["id"], g["id"]),
                        )
                    ],
                }
                for g in gs
            ],
        }


@router.post("/groups/{gid}/pair")
def pair(gid: int, force: bool = False):
    """Sinh lịch: vòng tròn = tất cả vòng; Swiss = chỉ vòng 1 (vòng sau dùng /swiss-next)."""
    with conn() as c:
        fmt = c.execute(
            "SELECT s.format FROM stages s JOIN groups g ON g.stage_id=s.id WHERE g.id=?",
            (gid,),
        ).fetchone()
        fmt = (fmt["format"] if fmt else "round_robin") or "round_robin"
        ids = [
            r["student_id"]
            for r in c.execute(
                "SELECT student_id FROM tournament_players WHERE group_id=? "
                "UNION SELECT student_id FROM stage_players WHERE group_id=?",
                (gid, gid),
            )
        ]
        if not ids:
            raise HTTPException(400, "Bảng chưa có người")
        if fmt not in ("round_robin", "swiss"):
            raise HTTPException(400, "Hãy dùng API ghép cặp đúng thể thức")
        if not force and c.execute(
            "SELECT 1 FROM pairings WHERE group_id=? AND black_id IS NOT NULL AND result IS NOT NULL AND result!=''",
            (gid,),
        ).fetchone():
            raise HTTPException(409, "Đã có kết quả; chỉ ghép lại khi xác nhận force=true")
        c.execute("DELETE FROM pairings WHERE group_id=?", (gid,))
        if fmt == "swiss":
            ratings = {
                r["id"]: r["rating"]
                for r in c.execute(
                    f"SELECT id,rating FROM students WHERE id IN ({','.join('?' * len(ids))})",
                    ids,
                )
            }
            rnd = pairing.swiss_pair(ids, [], ratings)
            for board, (w, b) in enumerate(rnd, 1):
                c.execute(
                    "INSERT INTO pairings(group_id,round,board,white_id,black_id,result) VALUES(?,?,?,?,?,?)",
                    (gid, 1, board, w, b, "bye" if b is None else None),
                )
            return {
                "format": "swiss",
                "round": 1,
                "rounds": pairing.recommended_swiss_rounds(len(ids)),
            }
        # round_robin
        for r, rnd in enumerate(pairing.round_robin(ids), 1):
            for board, (w, b) in enumerate(rnd, 1):
                c.execute(
                    "INSERT INTO pairings(group_id,round,board,white_id,black_id,result) VALUES(?,?,?,?,?,?)",
                    (gid, r, board, w, b, "bye" if b is None else None),
                )
        return {"format": "round_robin", "rounds": len(ids) - 1 + len(ids) % 2}


@router.post("/groups/{gid}/swiss-next")
def swiss_next(gid: int):
    """Hệ Thụy Sĩ: tạo vòng tiếp theo sau khi vòng hiện tại đã có đủ kết quả."""
    with conn() as c:
        fmt = c.execute(
            "SELECT s.format FROM stages s JOIN groups g ON g.stage_id=s.id WHERE g.id=?",
            (gid,),
        ).fetchone()
        if not fmt or fmt["format"] != "swiss":
            raise HTTPException(400, "Bảng này không dùng hệ Thụy Sĩ")
        ids = [
            r["student_id"]
            for r in c.execute(
                "SELECT student_id FROM tournament_players WHERE group_id=? "
                "UNION SELECT student_id FROM stage_players WHERE group_id=?",
                (gid, gid),
            )
        ]
        last = c.execute("SELECT MAX(round) m FROM pairings WHERE group_id=?", (gid,)).fetchone()["m"]
        if not last:
            raise HTTPException(400, "Chưa có vòng nào — hãy bấm Ghép cặp trước")
        if last >= pairing.recommended_swiss_rounds(len(ids)):
            raise HTTPException(409, "Đã đủ số vòng Thụy Sĩ")
        open_games = c.execute(
            "SELECT 1 FROM pairings WHERE group_id=? AND round=? AND black_id IS NOT NULL AND (result IS NULL OR result='')",
            (gid, last),
        ).fetchone()
        if open_games:
            raise HTTPException(400, f"Vòng {last} còn bàn chưa có kết quả")
        hist = [
            (r["white_id"], r["black_id"], r["result"])
            for r in c.execute("SELECT white_id,black_id,result FROM pairings WHERE group_id=?", (gid,))
        ]
        ratings = {
            r["id"]: r["rating"]
            for r in c.execute(
                f"SELECT id,rating FROM students WHERE id IN ({','.join('?' * len(ids))})",
                ids,
            )
        }
        nxt = last + 1
        rnd = pairing.swiss_pair(ids, hist, ratings, seed=nxt * 9973)
        for board, (w, b) in enumerate(rnd, 1):
            c.execute(
                "INSERT INTO pairings(group_id,round,board,white_id,black_id,result) VALUES(?,?,?,?,?,?)",
                (gid, nxt, board, w, b, "bye" if b is None else None),
            )
        return {"round": nxt, "boards": len(rnd)}


@router.get("/groups/{gid}/pairings")
def pairings(gid: int):
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM pairings WHERE group_id=? ORDER BY round,board", (gid,))]


class Result(BaseModel):
    result: str  # 1-0 | 0-1 | 1/2
    white_technical_errors: int | None = None
    black_technical_errors: int | None = None
    white_tactics_created: int | None = None
    black_tactics_created: int | None = None


def _metric(v: int | None) -> int | None:
    if v is None:
        return None
    if v < 0:
        raise HTTPException(400, "Chỉ số ván đấu không được âm")
    return int(v)


def _update_pairing_result(c, pid: int, b: Result):
    if b.result not in pairing.SCORE:
        raise HTTPException(400, "Kết quả phải là 1-0, 0-1 hoặc 1/2")
    p = c.execute("SELECT * FROM pairings WHERE id=?", (pid,)).fetchone()
    if not p:
        raise HTTPException(404, "Không tìm thấy ván đấu")
    if p["black_id"] is None:
        raise HTTPException(400, "Không nhập kết quả cho ván nghỉ")
    values = {
        "white_technical_errors": _metric(b.white_technical_errors),
        "black_technical_errors": _metric(b.black_technical_errors),
        "white_tactics_created": _metric(b.white_tactics_created),
        "black_tactics_created": _metric(b.black_tactics_created),
    }
    merged = {k: (values[k] if values[k] is not None else (p[k] or 0)) for k in values}
    c.execute(
        "UPDATE pairings SET result=?, white_technical_errors=?, black_technical_errors=?, "
        "white_tactics_created=?, black_tactics_created=? WHERE id=?",
        (b.result, merged["white_technical_errors"], merged["black_technical_errors"],
         merged["white_tactics_created"], merged["black_tactics_created"], pid),
    )
    return p


@router.put("/pairings/{pid}")
def set_result(pid: int, b: Result):
    with conn() as c:
        _update_pairing_result(c, pid, b)
    return {"ok": True}


def _group_fmt(c, gid):
    r = c.execute("SELECT s.format FROM groups g JOIN stages s ON s.id=g.stage_id WHERE g.id=?", (gid,)).fetchone()
    return r["format"] if r and r["format"] in pairing.TIEBREAK_ORDER else "swiss"


class BulkItem(Result):
    id: int


class BulkResults(BaseModel):
    items: list[BulkItem]


@router.put("/groups/{gid}/results/bulk")
def set_results_bulk(gid: int, b: BulkResults):
    """Xác nhận nhiều ván cùng lúc; hoặc lưu hết, hoặc không lưu ván nào."""
    if not b.items:
        raise HTTPException(400, "Không có ván nào để xác nhận")
    if len({i.id for i in b.items}) != len(b.items):
        raise HTTPException(400, "Có ván bị gửi trùng")
    with conn() as c:
        for it in b.items:
            p = c.execute("SELECT group_id FROM pairings WHERE id=?", (it.id,)).fetchone()
            if not p or p["group_id"] != gid:
                raise HTTPException(404, "Ván đấu không thuộc bảng này")
            _update_pairing_result(c, it.id, it)
    return {"ok": True, "saved": len(b.items)}


@router.get("/groups/{gid}/standings")
def standings(gid: int):
    with conn() as c:
        rows = c.execute("SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (gid,)).fetchall()
        fmt = _group_fmt(c, gid)
        names = {r["id"]: r["name"] for r in c.execute("SELECT id,name FROM students")}
    return [
        {**s, "name": names.get(s["student_id"])}
        for s in pairing.standings([tuple(r) for r in rows], fmt)
    ]


@router.get("/tournaments")
def list_tours():
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT id,name,date,status FROM tournaments ORDER BY id DESC")]


class Finals(BaseModel):
    per_group: int = Field(default=2, ge=1)
    format: str = "knockout"  # knockout | round_robin | swiss


@router.post("/tournaments/{tid}/finals")
def finals(tid: int, b: Finals):
    """Lấy N người đầu mỗi bảng vào chung kết."""
    fmt = b.format if b.format in ("knockout", "round_robin", "swiss") else "knockout"
    with conn() as c:
        if c.execute("SELECT 1 FROM stages WHERE tournament_id=? AND ord=2", (tid,)).fetchone():
            raise HTTPException(400, "Đã có vòng chung kết")
        gs = c.execute(
            "SELECT g.id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=? AND s.ord=1",
            (tid,),
        ).fetchall()
        q = []
        for g in gs:
            rows = c.execute(
                "SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (g["id"],)
            ).fetchall()
            if not rows or any(r["black_id"] and not r["result"] for r in rows):
                raise HTTPException(400, "Còn bảng chưa ghép cặp hoặc chưa đấu xong")
            q += pairing.standings([tuple(r) for r in rows], _group_fmt(c, g["id"]))[: b.per_group]
        if len(q) < 2:
            raise HTTPException(400, "Cần ít nhất 2 người vào chung kết")
        q.sort(key=lambda s: (s["rank"], -s["points"], -s["sb"]))
        st = c.execute(
            "INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,2,'Chung kết',?)",
            (tid, fmt),
        ).lastrowid
        g = c.execute("INSERT INTO groups(stage_id,name) VALUES(?,'Chung kết')", (st,)).lastrowid
        for i, s in enumerate(q, 1):
            c.execute("INSERT INTO stage_players VALUES(?,?,?)", (g, s["student_id"], i))
    return {"group_id": g, "players": len(q), "format": fmt}


def bracket(n):
    o = [1]
    while len(o) < n:
        m = len(o) * 2
        o = [y for s in o for y in (s, m + 1 - s)]
    return o


@router.post("/groups/{gid}/next-round")
def next_round(gid: int):
    """Loại trực tiếp: vòng đầu theo hạt giống; vòng sau lấy người thắng."""
    with conn() as c:
        last = c.execute("SELECT MAX(round) m FROM pairings WHERE group_id=?", (gid,)).fetchone()["m"]
        if not last:
            ids = [
                r[0]
                for r in c.execute(
                    "SELECT student_id FROM stage_players WHERE group_id=? ORDER BY seed", (gid,)
                )
            ]
            size = 1
            while size < len(ids):
                size *= 2
            ids += [None] * (size - len(ids))
            o = bracket(size)
            ent = [(ids[o[i] - 1], ids[o[i + 1] - 1]) for i in range(0, size, 2)]
            ent = [(a, b) if a is not None else (b, a) for a, b in ent]
            rnd = 1
        else:
            ws = []
            for p in c.execute(
                "SELECT * FROM pairings WHERE group_id=? AND round=? ORDER BY board", (gid, last)
            ):
                if p["black_id"] is None or p["result"] == "1-0":
                    ws.append(p["white_id"])
                elif p["result"] == "0-1":
                    ws.append(p["black_id"])
                else:
                    raise HTTPException(
                        400,
                        f"Bàn {p['board']} chưa có kết quả hoặc hòa, cần phân định (nhập 1-0 hoặc 0-1)",
                    )
            if len(ws) == 1:
                return {
                    "champion": c.execute(
                        "SELECT name FROM students WHERE id=?", (ws[0],)
                    ).fetchone()["name"]
                }
            ent = [(ws[i], ws[i + 1]) for i in range(0, len(ws), 2)]
            rnd = last + 1
        for board, (w, b) in enumerate(ent, 1):
            c.execute(
                "INSERT INTO pairings(group_id,round,board,white_id,black_id,result) VALUES(?,?,?,?,?,?)",
                (gid, rnd, board, w, b, "bye" if b is None else None),
            )
    return {"round": rnd}


class DrawReq(BaseModel):
    student_ids: list[int] | None = None
    group_count: int | None = Field(default=None, ge=1)
    group_size: int | None = Field(default=8, ge=1)
    mode: str = "pots"
    avoid_club: bool = True
    seed: int | None = None
    format: str = "round_robin"  # round_robin | swiss


def group_name(i, n):
    return NAMES[i] if n <= len(NAMES) else f"Bảng {i + 1}"


@router.post("/draw")
def draw(b: DrawReq):
    """Bốc thăm thử: chỉ trả kết quả để xem, chưa lưu."""
    with conn() as c:
        if b.student_ids is not None:
            b.student_ids = _student_ids(c, b.student_ids)
        rows = c.execute("SELECT id,rating,club FROM students").fetchall()
    keep = set(b.student_ids) if b.student_ids is not None else None
    players = [(r["id"], r["rating"], r["club"]) for r in rows if keep is None or r["id"] in keep]
    if len(players) < 2:
        raise HTTPException(400, "Cần ít nhất 2 học viên")
    n = b.group_count or max(1, round(len(players) / (b.group_size or 8)))
    if n > len(players):
        raise HTTPException(400, "Số bảng nhiều hơn số người")
    seed = b.seed if b.seed is not None else random.randrange(1 << 31)
    groups, conflicts = pairing.draw_groups(players, n, b.mode, seed, b.avoid_club)
    fmt = b.format if b.format in ("round_robin", "swiss") else "round_robin"
    return {
        "seed": seed,
        "conflicts": conflicts,
        "format": fmt,
        "groups": [{"name": group_name(i, n), "ids": ids} for i, ids in enumerate(groups)],
    }


class FromDraw(BaseModel):
    name: str
    date: str | None = None
    seed: int | None = None
    mode: str = "pots"
    format: str = "round_robin"  # round_robin | swiss
    groups: list[list[int]]
    group_names: list[str] | None = None
    group_formats: list[str] | None = None
    notes: str = ""


@router.post("/tournaments/from-draw")
def from_draw(b: FromDraw):
    """Chốt kết quả bốc thăm thành giải đấu."""
    ids = [i for g in b.groups for i in g]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "Có học viên nằm ở hai bảng")
    groups = b.groups if b.group_names is not None else [g for g in b.groups if g]
    if b.group_names is not None and len(b.group_names) != len(groups):
        raise HTTPException(400, "Số tên bảng không khớp số bảng")
    fmt = b.format if b.format in ("round_robin", "swiss") else "round_robin"
    if b.group_formats is not None and (len(b.group_formats) != len(groups) or any(f not in ("round_robin", "swiss") for f in b.group_formats)):
        raise HTTPException(400, "Thể thức bảng không hợp lệ hoặc không khớp số bảng")
    with conn() as c:
        if not set(ids) <= {r["id"] for r in c.execute("SELECT id FROM students")}:
            raise HTTPException(400, "Có học viên không tồn tại")
        t = c.execute(
            "INSERT INTO tournaments(name,date,seed,split_mode,notes) VALUES(?,?,?,?,?)",
            (b.name, b.date, b.seed or 0, b.mode, b.notes),
        ).lastrowid
        st = c.execute(
            "INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,1,'Vòng bảng',?)",
            (t, fmt),
        ).lastrowid
        stages = {fmt: st}
        for i, g_ids in enumerate(groups):
            group_fmt = b.group_formats[i] if b.group_formats is not None else fmt
            if group_fmt not in stages:
                stages[group_fmt] = c.execute("INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,1,'Vòng bảng',?)", (t, group_fmt)).lastrowid
            g = c.execute(
                "INSERT INTO groups(stage_id,name) VALUES(?,?)",
                (stages[group_fmt], (b.group_names[i].strip() or f"Bảng {i+1}") if b.group_names is not None else group_name(i, len(groups))),
            ).lastrowid
            for sid in g_ids:
                c.execute("INSERT INTO tournament_players VALUES(?,?,?)", (t, sid, g))
    return {"tournament_id": t, "format": fmt}


class TournamentInfo(BaseModel):
    name: str | None = None
    date: str | None = None
    notes: str | None = None


@router.patch("/tournaments/{tid}")
def update_tournament(tid: int, b: TournamentInfo):
    with conn() as c:
        if not c.execute("SELECT 1 FROM tournaments WHERE id=?", (tid,)).fetchone():
            raise HTTPException(404, "Không tìm thấy giải")
        for key in b.model_fields_set:
            value = getattr(b, key)
            if key == "name" and (value is None or not value.strip()):
                raise HTTPException(400, "Tên giải không được trống")
            c.execute(f"UPDATE tournaments SET {key}=? WHERE id=?", (value, tid))
    return {"ok": True}


class GroupInfo(BaseModel):
    name: str = ""
    format: str = "round_robin"


@router.post("/tournaments/{tid}/groups")
def add_group(tid: int, b: GroupInfo):
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        t = c.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "Không tìm thấy giải")
        if t["kind"] == "arena" or t["status"] == "finished":
            raise HTTPException(409, "Không thêm bảng cho Arena hoặc giải đã kết thúc")
        st = c.execute("SELECT id FROM stages WHERE tournament_id=? AND ord=1 AND format=?", (tid, b.format)).fetchone()
        if b.format not in ("round_robin", "swiss"):
            raise HTTPException(400, "Thể thức bảng không hợp lệ")
        sid = st["id"] if st else c.execute("INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,1,'Vòng bảng',?)", (tid,b.format)).lastrowid
        n = c.execute("SELECT COUNT(*) FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=? AND s.ord=1",(tid,)).fetchone()[0]
        gid = c.execute("INSERT INTO groups(stage_id,name) VALUES(?,?)", (sid,b.name.strip() or f"Bảng {n+1}")).lastrowid
    return {"group_id": gid}


class GroupUpdate(BaseModel):
    name: str | None = None
    format: str | None = None


@router.patch("/groups/{gid}")
def rename_group(gid: int, b: GroupUpdate):
    if b.name is not None and not b.name.strip():
        raise HTTPException(400, "Tên bảng không được trống")
    if "format" in b.model_fields_set and b.format not in ("round_robin", "swiss"):
        raise HTTPException(400, "Thể thức bảng không hợp lệ")
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        g = c.execute("SELECT s.tournament_id,s.ord,s.format,t.status,t.kind FROM groups g JOIN stages s ON s.id=g.stage_id JOIN tournaments t ON t.id=s.tournament_id WHERE g.id=?", (gid,)).fetchone()
        if not g:
            raise HTTPException(404, "Không tìm thấy bảng")
        if b.format is not None and b.format != g["format"]:
            if g["ord"] != 1 or g["kind"] == "arena" or g["status"] == "finished" or c.execute("SELECT 1 FROM pairings WHERE group_id=?", (gid,)).fetchone():
                raise HTTPException(409, "Chỉ đổi thể thức bảng trước khi ghép cặp và khi giải chưa kết thúc")
            st = c.execute("SELECT id FROM stages WHERE tournament_id=? AND ord=1 AND format=?", (g["tournament_id"], b.format)).fetchone()
            sid = st["id"] if st else c.execute("INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,1,'Vòng bảng',?)", (g["tournament_id"], b.format)).lastrowid
            c.execute("UPDATE groups SET stage_id=? WHERE id=?", (sid, gid))
        if b.name is not None:
            c.execute("UPDATE groups SET name=? WHERE id=?", (b.name.strip(), gid))
    return {"ok": True}


@router.delete("/groups/{gid}")
def delete_empty_group(gid: int):
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        g = c.execute("SELECT s.ord,s.format,t.status FROM groups g JOIN stages s ON s.id=g.stage_id JOIN tournaments t ON t.id=s.tournament_id WHERE g.id=?",(gid,)).fetchone()
        if not g:
            raise HTTPException(404, "Không tìm thấy bảng")
        if g["ord"] != 1 or g["format"] == "arena" or g["status"] == "finished":
            raise HTTPException(409, "Không xóa bảng này")
        for table in ("pairings", "stage_players", "tournament_players"):
            if c.execute(f"SELECT 1 FROM {table} WHERE group_id=?", (gid,)).fetchone():
                raise HTTPException(409, "Chỉ xóa được bảng trống, chưa ghép cặp")
        c.execute("DELETE FROM groups WHERE id=?",(gid,))
    return {"ok":True}


class GroupPlayers(BaseModel):
    student_ids: list[int]


@router.post("/groups/{gid}/import-students")
def import_group_students(gid: int, items: list[Student]):
    """Nhập học viên và thêm thẳng vào bảng trong cùng một transaction."""
    if not items:
        raise HTTPException(400, "Nhập ít nhất một học viên")
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        g = c.execute("SELECT s.tournament_id,s.ord,s.format,t.status FROM groups g JOIN stages s ON s.id=g.stage_id JOIN tournaments t ON t.id=s.tournament_id WHERE g.id=?", (gid,)).fetchone()
        if not g:
            raise HTTPException(404, "Không tìm thấy bảng")
        if g["ord"] != 1 or g["format"] == "arena" or g["status"] == "finished":
            raise HTTPException(409, "Không thêm người vào bảng này")
        if c.execute("SELECT 1 FROM pairings WHERE group_id=?", (gid,)).fetchone():
            raise HTTPException(409, "Bảng đã ghép cặp; không sửa danh sách để bảo vệ lịch và kết quả")
        added, created = 0, 0
        for student in items:
            name = student.name.strip()
            club = (student.club or "").strip() or None
            if not name:
                raise HTTPException(400, "Tên học viên không được trống")
            matches = c.execute("SELECT id FROM students WHERE name=? AND IFNULL(club,'')=IFNULL(?,'')", (name,club)).fetchall()
            if len(matches)>1:
                raise HTTPException(409, f"Có nhiều học viên tên {name}; hãy chọn đúng người bằng nút Chọn / thêm người")
            if matches:
                sid = matches[0]["id"]
            else:
                sid = c.execute("INSERT INTO students(name,rating,club) VALUES(?,?,?)", (name,student.rating,club)).lastrowid
                created += 1
            member = c.execute("SELECT group_id FROM tournament_players WHERE tournament_id=? AND student_id=?", (g["tournament_id"],sid)).fetchone()
            if member:
                if member["group_id"] != gid:
                    raise HTTPException(409, f"{name} đã ở bảng khác trong giải; chưa thêm danh sách này")
                continue
            c.execute("INSERT INTO tournament_players VALUES(?,?,?)",(g["tournament_id"],sid,gid))
            added += 1
    return {"added":added,"created":created,"skipped":len(items)-added}


@router.put("/groups/{gid}/players")
def replace_group_players(gid: int, b: GroupPlayers):
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        g = c.execute("SELECT s.tournament_id,s.ord,s.format,t.status FROM groups g JOIN stages s ON s.id=g.stage_id JOIN tournaments t ON t.id=s.tournament_id WHERE g.id=?", (gid,)).fetchone()
        if not g:
            raise HTTPException(404, "Không tìm thấy bảng")
        if g["ord"] != 1 or g["format"] == "arena" or g["status"] == "finished":
            raise HTTPException(409, "Không sửa danh sách bảng này")
        if c.execute("SELECT 1 FROM pairings WHERE group_id=?", (gid,)).fetchone():
            raise HTTPException(409, "Bảng đã ghép cặp; giữ nguyên danh sách để bảo vệ lịch và kết quả")
        ids = _student_ids(c,b.student_ids)
        for sid in ids:
            other = c.execute("SELECT group_id FROM tournament_players WHERE tournament_id=? AND student_id=? AND group_id!=?", (g["tournament_id"],sid,gid)).fetchone()
            if other:
                raise HTTPException(409, "Học viên đã ở bảng khác; bỏ khỏi bảng đó trước khi thêm vào bảng này")
        c.execute("DELETE FROM tournament_players WHERE group_id=?", (gid,))
        for sid in ids:
            c.execute("INSERT INTO tournament_players VALUES(?,?,?)",(g["tournament_id"],sid,gid))
    return {"ok":True,"players":len(ids)}


@router.post("/tournaments/{tid}/finish")
def finish_tour(tid: int):
    """Kết thúc giải: đánh dấu finished và trả bảng xếp hạng tất cả các bảng."""
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        c.execute("UPDATE tournaments SET status='finished' WHERE id=?", (tid,))
        gs = c.execute(
            "SELECT g.id,g.name,s.ord,s.format FROM groups g JOIN stages s ON s.id=g.stage_id "
            "WHERE s.tournament_id=? ORDER BY s.ord,g.id",
            (tid,),
        ).fetchall()
        names = {r["id"]: r["name"] for r in c.execute("SELECT id,name FROM students")}
        out = []
        for g in gs:
            rows = c.execute(
                "SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (g["id"],)
            ).fetchall()
            st = pairing.standings([tuple(r) for r in rows], g["format"])
            for s in st:
                s["name"] = names.get(s["student_id"])
            champion = None
            if g["format"] == "knockout" and st:
                champion = st[0].get("name")
            out.append({
                "group_id": g["id"],
                "name": g["name"],
                "ord": g["ord"],
                "format": g["format"],
                "standings": st,
                "champion": champion,
            })
    return {"tournament_id": tid, "name": t["name"], "status": "finished", "groups": out}


@router.get("/tournaments/{tid}/results")
def tour_results(tid: int):
    """Xem bảng kết quả (không bắt buộc finish)."""
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        gs = c.execute(
            "SELECT g.id,g.name,s.ord,s.format FROM groups g JOIN stages s ON s.id=g.stage_id "
            "WHERE s.tournament_id=? ORDER BY s.ord,g.id",
            (tid,),
        ).fetchall()
        names = {r["id"]: r["name"] for r in c.execute("SELECT id,name FROM students")}
        out = []
        for g in gs:
            rows = c.execute(
                "SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (g["id"],)
            ).fetchall()
            st = pairing.standings([tuple(r) for r in rows], g["format"])
            for s in st:
                s["name"] = names.get(s["student_id"])
            out.append({
                "group_id": g["id"],
                "name": g["name"],
                "ord": g["ord"],
                "format": g["format"],
                "standings": st,
            })
    return {"tournament_id": tid, "name": t["name"], "status": t["status"], "groups": out}


# ===================== ĐẤU TRƯỜNG (ARENA) =====================
from datetime import datetime, timedelta, timezone

def _now_iso():
    return datetime.now(timezone.utc).astimezone().replace(microsecond=0).isoformat(timespec="seconds")


class NewArena(BaseModel):
    name: str
    duration_min: int = Field(default=60, ge=5)  # thời lượng (phút)
    student_ids: list[int] | None = None


@router.post("/arenas")
def create_arena(b: NewArena):
    """Tạo giải đấu trường (chưa start)."""
    if b.duration_min < 5:
        raise HTTPException(400, "Thời lượng tối thiểu 5 phút")
    with conn() as c:
        ids = _student_ids(c, b.student_ids)
        t = c.execute(
            "INSERT INTO tournaments(name,date,seed,split_mode,status,kind,duration_min) VALUES(?,?,?,?,?,?,?)",
            (b.name, None, 0, "arena", "prepare", "arena", b.duration_min),
        ).lastrowid
        st = c.execute(
            "INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,1,'Đấu trường','arena')",
            (t,),
        ).lastrowid
        g = c.execute("INSERT INTO groups(stage_id,name) VALUES(?,'Arena')", (st,)).lastrowid
        for sid in ids:
            c.execute("INSERT INTO tournament_players VALUES(?,?,?)", (t, sid, g))
            c.execute(
                "INSERT OR IGNORE INTO arena_players(tournament_id,student_id,status) VALUES(?,?,?)",
                (t, sid, "waiting"),
            )
    return {"tournament_id": t, "group_id": g, "duration_min": b.duration_min}


class ArenaPlayers(BaseModel):
    student_ids: list[int]


@router.post("/arenas/{tid}/players")
def arena_add_players(tid: int, b: ArenaPlayers):
    """Thêm đối thủ vào đấu trường (kể cả đang chạy)."""
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=? AND kind='arena'", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "Không tìm thấy đấu trường")
        g = c.execute(
            "SELECT g.id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=?",
            (tid,),
        ).fetchone()
        if not g:
            raise HTTPException(400, "Đấu trường chưa có bảng")
        gid = g["id"]
        added = 0
        for sid in _student_ids(c, b.student_ids):
            exists = c.execute(
                "SELECT 1 FROM tournament_players WHERE tournament_id=? AND student_id=?",
                (tid, sid),
            ).fetchone()
            if exists:
                continue
            c.execute("INSERT INTO tournament_players VALUES(?,?,?)", (tid, sid, gid))
            c.execute(
                "INSERT OR IGNORE INTO arena_players(tournament_id,student_id,status) VALUES(?,?,?)",
                (tid, sid, "waiting"),
            )
            added += 1
    return {"added": added}


@router.delete("/arenas/{tid}/players/{sid}")
def arena_remove_player(tid: int, sid: int):
    """Loại đối thủ khỏi đấu trường (không xóa kết quả đã đấu)."""
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=? AND kind='arena'", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        # đang chơi thì không cho xóa
        playing = c.execute(
            "SELECT 1 FROM arena_players WHERE tournament_id=? AND student_id=? AND status='playing'",
            (tid, sid),
        ).fetchone()
        if playing:
            raise HTTPException(400, "Người này đang đấu — hãy nhập kết quả trước")
        c.execute("DELETE FROM arena_players WHERE tournament_id=? AND student_id=?", (tid, sid))
        c.execute("DELETE FROM tournament_players WHERE tournament_id=? AND student_id=?", (tid, sid))
    return {"ok": True}


@router.post("/arenas/{tid}/start")
def arena_start(tid: int):
    """Bắt đầu đếm giờ đấu trường."""
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=? AND kind='arena'", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        if t["status"] == "running":
            return {"ok": True, "starts_at": t["starts_at"], "ends_at": t["ends_at"]}
        if t["status"] == "finished":
            raise HTTPException(400, "Đấu trường đã kết thúc")
        dur = t["duration_min"] or 60
        start = datetime.now().astimezone().replace(microsecond=0)
        end = start + timedelta(minutes=dur)
        c.execute(
            "UPDATE tournaments SET status='running', starts_at=?, ends_at=? WHERE id=?",
            (start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds"), tid),
        )
        # Phục hồi trạng thái theo ván còn mở, kể cả lịch được tạo bởi bản cũ.
        c.execute("UPDATE arena_players SET status=CASE WHEN EXISTS ("
                  "SELECT 1 FROM pairings p JOIN groups g ON g.id=p.group_id JOIN stages s ON s.id=g.stage_id "
                  "WHERE s.tournament_id=? AND (p.white_id=arena_players.student_id OR p.black_id=arena_players.student_id) "
                  "AND p.black_id IS NOT NULL AND (p.result IS NULL OR p.result='')) "
                  "THEN 'playing' ELSE 'waiting' END WHERE tournament_id=?", (tid, tid))
    return {"ok": True, "starts_at": start.isoformat(timespec="seconds"), "ends_at": end.isoformat(timespec="seconds")}


@router.post("/arenas/{tid}/pair")
def arena_pair(tid: int):
    """Ghép người chờ, bảo đảm mỗi người chỉ có một ván mở."""
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        t = c.execute("SELECT * FROM tournaments WHERE id=? AND kind='arena'", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        if t["status"] == "finished":
            raise HTTPException(400, "Đấu trường đã kết thúc")
        if t["status"] != "running":
            raise HTTPException(409, "Hãy bắt đầu đấu trường trước khi ghép cặp")
        # hết giờ?
        if t["ends_at"]:
            try:
                end = datetime.fromisoformat(t["ends_at"])
                if datetime.now().astimezone() >= end.replace(tzinfo=end.tzinfo):
                    c.execute("UPDATE tournaments SET status='finished' WHERE id=?", (tid,))
                    c.commit()  # raise bên dưới sẽ rollback nếu chưa commit
                    raise HTTPException(400, "Đã hết thời gian đấu trường")
            except ValueError:
                pass
        g = c.execute(
            "SELECT g.id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=?",
            (tid,),
        ).fetchone()
        gid = g["id"]
        waiting = [
            r["student_id"]
            for r in c.execute(
                "SELECT student_id FROM arena_players WHERE tournament_id=? AND status='waiting' ORDER BY student_id",
                (tid,),
            )
        ]
        busy = {sid for p in c.execute(
            "SELECT white_id,black_id FROM pairings WHERE group_id=? AND black_id IS NOT NULL AND (result IS NULL OR result='')", (gid,)
        ) for sid in p}
        for sid in busy:
            c.execute("UPDATE arena_players SET status='playing' WHERE tournament_id=? AND student_id=?", (tid, sid))
        waiting = [sid for sid in waiting if sid not in busy]
        if len(waiting) < 2:
            return {"paired": 0, "message": "Cần ít nhất 2 người đang chờ"}
        # lịch sử để tránh tái đấu gần đây nếu có thể
        hist = [
            (r["white_id"], r["black_id"], r["result"])
            for r in c.execute("SELECT white_id,black_id,result FROM pairings WHERE group_id=?", (gid,))
        ]
        ratings = {
            r["id"]: r["rating"]
            for r in c.execute("SELECT id,rating FROM students")
        }
        # dùng swiss_pair trên nhóm waiting
        rnd = pairing.swiss_pair(waiting, hist, ratings)
        last_round = c.execute("SELECT MAX(round) m FROM pairings WHERE group_id=?", (gid,)).fetchone()["m"] or 0
        nxt = last_round + 1
        paired = 0
        boards = []
        for board, (w, b) in enumerate(((w, b) for w, b in rnd if b is not None), 1):
            c.execute(
                "INSERT INTO pairings(group_id,round,board,white_id,black_id,result) VALUES(?,?,?,?,?,?)",
                (gid, nxt, board, w, b, None),
            )
            c.execute(
                "UPDATE arena_players SET status='playing' WHERE tournament_id=? AND student_id IN (?,?)",
                (tid, w, b),
            )
            paired += 1
            boards.append({"pairing_id": None, "white_id": w, "black_id": b})
        # lấy pairing ids vừa tạo
        rows = c.execute(
            "SELECT id,white_id,black_id FROM pairings WHERE group_id=? AND round=? AND black_id IS NOT NULL",
            (gid, nxt),
        ).fetchall()
        boards = [{"pairing_id": r["id"], "white_id": r["white_id"], "black_id": r["black_id"]} for r in rows]
    return {"paired": paired, "round": nxt, "boards": boards}


@router.put("/arenas/pairings/{pid}")
def arena_set_result(pid: int, b: Result):
    """Nhập/sửa kết quả ván arena và lưu chỉ số kỹ thuật/chiến thuật."""
    with conn() as c:
        p = _update_pairing_result(c, pid, b)
        # tìm tournament_id
        row = c.execute(
            "SELECT s.tournament_id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE g.id=?",
            (p["group_id"],),
        ).fetchone()
        if row:
            tid = row["tournament_id"]
            for sid in (p["white_id"], p["black_id"]):
                if not sid:
                    continue
                busy = c.execute(
                    "SELECT 1 FROM pairings WHERE group_id=? AND id!=? AND (white_id=? OR black_id=?) "
                    "AND black_id IS NOT NULL AND (result IS NULL OR result='')",
                    (p["group_id"], pid, sid, sid),
                ).fetchone()
                if not busy:
                    c.execute(
                        "UPDATE arena_players SET status='waiting' WHERE tournament_id=? AND student_id=?",
                        (tid, sid),
                    )
    return {"ok": True}


def _history_names(tid):
    with conn() as c:
        return c.execute("SELECT DISTINCT st.id,st.name FROM students st JOIN pairings p ON st.id IN (p.white_id,p.black_id) "
                         "JOIN groups g ON g.id=p.group_id JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=?", (tid,)).fetchall()


@router.get("/arenas/{tid}")
def get_arena(tid: int):
    """Chi tiết đấu trường: người chơi, trạng thái, ván đang đấu, xếp hạng."""
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=? AND kind='arena'", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        g = c.execute(
            "SELECT g.id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=?",
            (tid,),
        ).fetchone()
        gid = g["id"] if g else None
        players = []
        for r in c.execute(
            "SELECT ap.student_id,ap.status,s.name,s.rating,s.club FROM arena_players ap "
            "JOIN students s ON s.id=ap.student_id WHERE ap.tournament_id=? ORDER BY s.name",
            (tid,),
        ):
            players.append(dict(r))
        live = []
        games = []
        if gid:
            for r in c.execute(
                "SELECT * FROM pairings WHERE group_id=? AND black_id IS NOT NULL ORDER BY id DESC",
                (gid,),
            ):
                row = dict(r)
                games.append(row)
                if not row.get("result"):
                    live.append(row)
            hist = c.execute(
                "SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (gid,)
            ).fetchall()
            names = {r["id"]: r["name"] for r in c.execute("SELECT id,name FROM students")}
            st = pairing.standings([tuple(r) for r in hist])
            for s in st:
                s["name"] = names.get(s["student_id"])
        else:
            st = []
            games = []
        # remaining seconds
        remain = None
        if t["ends_at"] and t["status"] == "running":
            try:
                end = datetime.fromisoformat(t["ends_at"])
                now = datetime.now().astimezone()
                if end.tzinfo is None:
                    end = end.replace(tzinfo=now.tzinfo)
                remain = max(0, int((end - now).total_seconds()))
                if remain == 0 and t["status"] == "running":
                    c.execute("UPDATE tournaments SET status='finished' WHERE id=?", (tid,))
                    t = dict(t)
                    t["status"] = "finished"
            except ValueError:
                pass
    return {
        **dict(t),
        "group_id": gid,
        "players": players,
        "live": live,
        "games": games,
        "standings": st,
        "names": {r["id"]: r["name"] for r in _history_names(tid)},
        "remain_sec": remain,
    }


@router.get("/arenas")
def list_arenas():
    with conn() as c:
        return [
            dict(r)
            for r in c.execute(
                "SELECT id,name,status,duration_min,starts_at,ends_at FROM tournaments WHERE kind='arena' ORDER BY id DESC"
            )
        ]


class DeleteReq(BaseModel):
    password: str


def _purge_tournament(c, tid):
    """Xóa giải và mọi dữ liệu liên quan, đúng thứ tự khóa ngoại: bảng con trước, groups sau."""
    gids = [
        r["id"]
        for r in c.execute(
            "SELECT g.id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=?", (tid,)
        )
    ]
    # tournament_players.group_id tham chiếu groups (không CASCADE) nên phải xóa trước khi xóa groups
    c.execute("DELETE FROM tournament_players WHERE tournament_id=?", (tid,))
    c.execute("DELETE FROM arena_players WHERE tournament_id=?", (tid,))
    for gid in gids:
        c.execute("DELETE FROM pairings WHERE group_id=?", (gid,))
        c.execute("DELETE FROM stage_players WHERE group_id=?", (gid,))
        c.execute("DELETE FROM groups WHERE id=?", (gid,))
    c.execute("DELETE FROM stages WHERE tournament_id=?", (tid,))
    c.execute("DELETE FROM tournaments WHERE id=?", (tid,))


@router.post("/tournaments/{tid}/delete")
def delete_tournament(tid: int, b: DeleteReq):
    """Xóa giải (classic / arena). Cần mật khẩu quản trị."""
    if not ADMIN_PASSWORD:
        raise HTTPException(503, "Chưa cấu hình ADMIN_PASSWORD")
    if b.password != ADMIN_PASSWORD:
        raise HTTPException(403, "Sai mật khẩu")
    with conn() as c:
        t = c.execute("SELECT id,name FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "Không tìm thấy giải")
        _purge_tournament(c, tid)
    return {"ok": True, "deleted": tid, "name": t["name"]}


@router.post("/arenas/{tid}/delete")
def delete_arena(tid: int, b: DeleteReq):
    """Xóa đấu trường — cùng logic, chỉ kiểm tra kind=arena."""
    if not ADMIN_PASSWORD:
        raise HTTPException(503, "Chưa cấu hình ADMIN_PASSWORD")
    if b.password != ADMIN_PASSWORD:
        raise HTTPException(403, "Sai mật khẩu")
    with conn() as c:
        t = c.execute("SELECT id,name FROM tournaments WHERE id=? AND kind='arena'", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "Không tìm thấy đấu trường")
        _purge_tournament(c, tid)
    return {"ok": True, "deleted": tid, "name": t["name"]}