import random
import json
from math import ceil
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from db import conn
from services import pairing
from config import ADMIN_PASSWORD

router = APIRouter(prefix="/api")
NAMES = ["Thiên", "Địa", "Huyền", "Hoàng", "Vũ", "Trụ", "Hồng", "Hoang"]


def _ids(c, gid):
    return [r[0] for r in c.execute(
        "SELECT student_id FROM tournament_players WHERE group_id=? UNION "
        "SELECT student_id FROM stage_players WHERE group_id=? ORDER BY student_id", (gid, gid))]


def _group(c, gid, active=False):
    g = c.execute("SELECT g.*,s.format,s.ord,s.tournament_id,t.seed,t.kind,t.status "
                  "FROM groups g JOIN stages s ON s.id=g.stage_id JOIN tournaments t ON t.id=s.tournament_id "
                  "WHERE g.id=?", (gid,)).fetchone()
    if not g:
        raise HTTPException(404, "Không tìm thấy bảng")
    if active and g["status"] == "finished":
        raise HTTPException(409, "Giải đã kết thúc; lịch đấu và kết quả đã khóa")
    if active and g["ord"] == 1 and g["kind"] != "arena" and c.execute(
        "SELECT 1 FROM stages WHERE tournament_id=? AND ord>1", (g["tournament_id"],)).fetchone():
        raise HTTPException(409, "Vòng bảng đã khóa sau khi lập chung kết")
    return g


def _round_limit(g, count):
    return g["swiss_rounds"] or pairing.recommended_swiss_rounds(count)


def _table(c, g, rows):
    ids = _ids(c, g["id"])
    if g["format"] == "knockout":
        return pairing.knockout_standings([tuple(r) for r in rows], ids)
    return pairing.standings([tuple(r) for r in rows], g["format"], ids,
                            _round_limit(g, len(ids)) if g["format"] == "swiss" else None)


def _audit(c, tid, action, details):
    c.execute("INSERT INTO tournament_events(tournament_id,action,details) VALUES(?,?,?)",
              (tid, action, json.dumps(details, ensure_ascii=False)))


def _audit_pairs(c, g, action):
    _audit(c, g["tournament_id"], action, {
        "group_id": g["id"], "format": g["format"], "seed": g["seed"],
        "algorithm": "berger-v2" if g["format"] == "round_robin" else "seeded-bracket-v2" if g["format"] == "knockout" else "club-matching-v2",
        "swiss_rounds": _round_limit(g, len(_ids(c, g["id"]))) if g["format"] == "swiss" else None,
        "players": [dict(r) for r in c.execute("SELECT id,name,rating,club FROM students WHERE id IN ("
                    "SELECT student_id FROM tournament_players WHERE group_id=? UNION "
                    "SELECT student_id FROM stage_players WHERE group_id=?) ORDER BY id", (g["id"], g["id"]))],
        "pairings": [dict(r) for r in c.execute("SELECT * FROM pairings WHERE group_id=? ORDER BY round,board", (g["id"],))],
    })


def _swiss(ids, hist, ratings, seed):
    try:
        return pairing.swiss_pair(ids, hist, ratings, seed)
    except pairing.PairingError as exc:
        raise HTTPException(409, str(exc)) from exc


def _complete_group(c, g):
    rows = c.execute("SELECT * FROM pairings WHERE group_id=? ORDER BY round,board", (g["id"],)).fetchall()
    if not rows or any(p["black_id"] is not None and p["result"] not in pairing.SCORE for p in rows):
        raise HTTPException(409, f"Bảng {g['name']} chưa ghép cặp hoặc chưa nhập đủ kết quả")
    last = rows[-1]["round"]
    ids = _ids(c, g["id"])
    if g["format"] == "swiss" and last < _round_limit(g, len(ids)):
        raise HTTPException(409, f"Bảng {g['name']} chưa đấu đủ số vòng Swiss đã chốt")
    if g["format"] in ("swiss", "round_robin"):
        expected = _round_limit(g, len(ids)) if g["format"] == "swiss" else len(ids) - 1 + len(ids) % 2
        if last != expected:
            raise HTTPException(409, f"Bảng {g['name']} không khớp số vòng dự kiến")
        for rnd in range(1, last + 1):
            participants = [x for p in rows if p["round"] == rnd for x in (p["white_id"], p["black_id"]) if x is not None]
            if sorted(participants) != sorted(ids):
                raise HTTPException(409, f"Bảng {g['name']}, vòng {rnd}: lịch thiếu hoặc trùng người")
    if g["format"] == "knockout":
        final = [p for p in rows if p["round"] == last]
        if len(final) != 1 or final[0]["result"] not in ("1-0", "0-1"):
            raise HTTPException(409, f"Bảng {g['name']} chưa có kết quả chung kết phân định thắng thua")
    return rows


def _champion(rows):
    if not rows:
        return None
    last = max(p["round"] for p in rows)
    final = [p for p in rows if p["round"] == last]
    if len(final) != 1 or final[0]["black_id"] is None:
        return None
    p = final[0]
    return p["white_id"] if p["result"] == "1-0" else p["black_id"] if p["result"] == "0-1" else None


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
    if not b.name.strip() or b.format not in ("round_robin", "swiss") or b.split_mode not in ("random", "seeded"):
        raise HTTPException(400, "Tên giải, thể thức hoặc cách chia bảng không hợp lệ")
    fmt = b.format
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
        n = b.group_count or max(1, ceil(len(rows) / (b.group_size or 8)))
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
        _audit(c, t, "create", {"seed": seed, "mode": b.split_mode, "groups": out})
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
        _group(c, b.group_id, active=True)
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
            "SELECT g.id,g.name,g.swiss_rounds,s.ord,s.format FROM groups g JOIN stages s ON s.id=g.stage_id "
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
        c.execute("BEGIN IMMEDIATE")
        g = _group(c, gid, active=True)
        fmt = g["format"]
        ids = _ids(c, gid)
        if len(ids) < 2:
            raise HTTPException(400, "Cần ít nhất 2 người trong bảng để ghép cặp")
        if fmt not in ("round_robin", "swiss"):
            raise HTTPException(400, "Hãy dùng API ghép cặp đúng thể thức")
        existing = c.execute("SELECT 1 FROM pairings WHERE group_id=?", (gid,)).fetchone()
        if existing and not force:
            raise HTTPException(409, "Đã có lịch đấu; chỉ ghép lại khi xác nhận force=true")
        if fmt == "swiss":
            limit = _round_limit(g, len(ids))
            if limit > len(ids) - 1 + len(ids) % 2:
                raise HTTPException(400, "Số vòng Swiss vượt số đối thủ/ván nghỉ có thể ghép không tái đấu")
            ratings = {r["id"]: r["rating"] for r in c.execute("SELECT id,rating FROM students")}
            rounds = [_swiss(ids, [], ratings, g["seed"] or 0)]
            c.execute("UPDATE groups SET swiss_rounds=? WHERE id=?", (limit, gid))
        else:
            # Draw pairing numbers once, reproducibly, before applying the Berger schedule.
            random.Random((g["seed"] or 0) + gid).shuffle(ids)
            rounds = pairing.round_robin(ids)
            limit = len(rounds)
        if existing:
            _audit_pairs(c, g, "schedule_before_reset")
        c.execute("DELETE FROM pairings WHERE group_id=?", (gid,))
        for r, rnd in enumerate(rounds, 1):
            for board, (w, b) in enumerate(rnd, 1):
                c.execute("INSERT INTO pairings(group_id,round,board,white_id,black_id,result) VALUES(?,?,?,?,?,?)",
                          (gid, r, board, w, b, "bye" if b is None else None))
        _audit_pairs(c, _group(c, gid), "pair_round_1" if fmt == "swiss" else "pair_round_robin")
        return {"format": fmt, "round": 1, "rounds": limit}


@router.post("/groups/{gid}/swiss-next")
def swiss_next(gid: int):
    """Hệ Thụy Sĩ: tạo vòng tiếp theo sau khi vòng hiện tại đã có đủ kết quả."""
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        g = _group(c, gid, active=True)
        if g["format"] != "swiss":
            raise HTTPException(400, "Bảng này không dùng hệ Thụy Sĩ")
        ids = _ids(c, gid)
        last = c.execute("SELECT MAX(round) FROM pairings WHERE group_id=?", (gid,)).fetchone()[0]
        if not last:
            raise HTTPException(400, "Chưa có vòng nào — hãy bấm Ghép cặp trước")
        if last >= _round_limit(g, len(ids)):
            raise HTTPException(409, "Đã đủ số vòng Thụy Sĩ đã chốt")
        if c.execute("SELECT 1 FROM pairings WHERE group_id=? AND black_id IS NOT NULL AND (result IS NULL OR result='')", (gid,)).fetchone():
            raise HTTPException(400, f"Vòng {last} hoặc vòng trước còn bàn chưa có kết quả")
        hist = [tuple(r) for r in c.execute("SELECT white_id,black_id,result FROM pairings WHERE group_id=? ORDER BY round,board", (gid,))]
        ratings = {r["id"]: r["rating"] for r in c.execute("SELECT id,rating FROM students")}
        nxt = last + 1
        rnd = _swiss(ids, hist, ratings, seed=g["seed"] or 0)
        for board, (w, b) in enumerate(rnd, 1):
            c.execute("INSERT INTO pairings(group_id,round,board,white_id,black_id,result) VALUES(?,?,?,?,?,?)",
                      (gid, nxt, board, w, b, "bye" if b is None else None))
        _audit_pairs(c, g, "pair_swiss_round")
        return {"round": nxt, "boards": len(rnd), "rounds": _round_limit(g, len(ids))}


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


def _update_pairing_result(c, pid: int, b: Result, arena_only=False):
    if b.result not in pairing.SCORE:
        raise HTTPException(400, "Kết quả phải là 1-0, 0-1 hoặc 1/2")
    p = c.execute("SELECT * FROM pairings WHERE id=?", (pid,)).fetchone()
    if not p:
        raise HTTPException(404, "Không tìm thấy ván đấu")
    if p["black_id"] is None:
        raise HTTPException(400, "Không nhập kết quả cho ván nghỉ")
    g = _group(c, p["group_id"], active=False)
    if (g["kind"] == "arena") != arena_only:
        raise HTTPException(400, "Hãy dùng API kết quả đúng loại giải")
    if g["kind"] != "arena":
        _group(c, p["group_id"], active=True)
    if b.result != p["result"] and g["format"] in ("swiss", "knockout") and c.execute(
        "SELECT 1 FROM pairings WHERE group_id=? AND round>?", (p["group_id"], p["round"])).fetchone():
        raise HTTPException(409, "Không sửa kết quả vòng trước sau khi đã ghép vòng sau; lịch đấu phụ thuộc kết quả này")
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
    _audit(c, g["tournament_id"], "result", {"pairing_id": pid, "before": dict(p),
           "after": {"result": b.result, **merged}})
    return p


@router.put("/pairings/{pid}")
def set_result(pid: int, b: Result):
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        _update_pairing_result(c, pid, b)
    return {"ok": True}


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
        c.execute("BEGIN IMMEDIATE")
        for it in b.items:
            p = c.execute("SELECT group_id FROM pairings WHERE id=?", (it.id,)).fetchone()
            if not p or p["group_id"] != gid:
                raise HTTPException(404, "Ván đấu không thuộc bảng này")
            _update_pairing_result(c, it.id, it)
    return {"ok": True, "saved": len(b.items)}


@router.get("/groups/{gid}/standings")
def standings(gid: int):
    with conn() as c:
        g = _group(c, gid)
        rows = c.execute("SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (gid,)).fetchall()
        names = {r["id"]: r["name"] for r in c.execute("SELECT id,name FROM students")}
        table = _table(c, g, rows)
    return [
        {**s, "name": names.get(s["student_id"])}
        for s in table
    ]


@router.get("/tournaments")
def list_tours():
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT id,name,date,status FROM tournaments ORDER BY id DESC")]


@router.get("/tournaments/{tid}/audit")
def tournament_audit(tid: int, download: bool = False):
    with conn() as c:
        t = c.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "Không tìm thấy giải")
        events = [{**dict(r), "details": json.loads(r["details"])} for r in c.execute(
            "SELECT id,action,details,at FROM tournament_events WHERE tournament_id=? ORDER BY id", (tid,))]
        payload = {"tournament": dict(t), "events": events,
                   "notice": "Nhật ký bắt đầu từ phiên bản có tính năng này; không phải biên bản có chữ ký hoặc chứng nhận FIDE."}
    if download:
        return Response(json.dumps(payload, ensure_ascii=False, indent=2), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="tournament-{tid}-audit.json"'})
    return payload


class Finals(BaseModel):
    per_group: int = Field(default=2, ge=1)
    format: str = "knockout"  # knockout | round_robin | swiss


@router.post("/tournaments/{tid}/finals")
def finals(tid: int, b: Finals):
    """Lấy N người đầu mỗi bảng vào chung kết."""
    if b.format not in ("knockout", "round_robin", "swiss"):
        raise HTTPException(400, "Thể thức chung kết không hợp lệ")
    fmt = b.format
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        t = c.execute("SELECT status,kind FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "Không tìm thấy giải")
        if t["status"] == "finished" or t["kind"] == "arena":
            raise HTTPException(409, "Không lập chung kết cho giải đã kết thúc hoặc Arena")
        if c.execute("SELECT 1 FROM stages WHERE tournament_id=? AND ord=2", (tid,)).fetchone():
            raise HTTPException(400, "Đã có vòng chung kết")
        gs = c.execute(
            "SELECT g.id FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=? AND s.ord=1",
            (tid,),
        ).fetchall()
        q = []
        for g in gs:
            info = _group(c, g["id"])
            _complete_group(c, info)
            rows = c.execute("SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (g["id"],)).fetchall()
            st = _table(c, info, rows)
            if len(st) > b.per_group and st[b.per_group - 1]["rank"] == st[b.per_group]["rank"]:
                raise HTTPException(409, f"Bảng {info['name']} còn đồng hạng tại suất vào chung kết; cần trọng tài phân định theo thể lệ")
            q += st[: b.per_group]
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
        _audit(c, tid, "finals", {"group_id": g, "format": fmt, "qualifiers": q})
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
        c.execute("BEGIN IMMEDIATE")
        g = _group(c, gid, active=True)
        if g["format"] != "knockout":
            raise HTTPException(400, "Bảng này không dùng loại trực tiếp")
        last = c.execute("SELECT MAX(round) m FROM pairings WHERE group_id=?", (gid,)).fetchone()["m"]
        if not last:
            ids = [
                r[0]
                for r in c.execute(
                    "SELECT student_id FROM stage_players WHERE group_id=? ORDER BY seed", (gid,)
                )
            ]
            if len(ids) < 2:
                raise HTTPException(400, "Cần ít nhất 2 người trong nhánh đấu")
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
        _audit_pairs(c, g, "pair_knockout_round")
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
    if b.mode not in ("pots", "random") or b.format not in ("round_robin", "swiss"):
        raise HTTPException(400, "Cách bốc thăm hoặc thể thức không hợp lệ")
    n = b.group_count or max(1, ceil(len(players) / (b.group_size or 8)))
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
    avoid_club: bool | None = None


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
        c.execute("BEGIN IMMEDIATE")
        if not b.name.strip() or b.format not in ("round_robin", "swiss") or b.mode not in ("pots", "random", "manual"):
            raise HTTPException(400, "Tên giải, thể thức hoặc cách bốc thăm không hợp lệ")
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
        _audit(c, t, "confirm_draw", {"seed": b.seed, "mode": b.mode, "avoid_club": b.avoid_club,
               "algorithm": "draw-pots-v2", "groups": b.groups,
               "group_names": b.group_names, "group_formats": b.group_formats,
               "players": [dict(r) for r in c.execute("SELECT id,name,rating,club FROM students ORDER BY id") if r["id"] in ids]})
    return {"tournament_id": t, "format": fmt}


class TournamentInfo(BaseModel):
    name: str | None = None
    date: str | None = None
    notes: str | None = None


@router.patch("/tournaments/{tid}")
def update_tournament(tid: int, b: TournamentInfo):
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        if not c.execute("SELECT 1 FROM tournaments WHERE id=?", (tid,)).fetchone():
            raise HTTPException(404, "Không tìm thấy giải")
        for key in b.model_fields_set:
            value = getattr(b, key)
            if key == "name" and (value is None or not value.strip()):
                raise HTTPException(400, "Tên giải không được trống")
            c.execute(f"UPDATE tournaments SET {key}=? WHERE id=?", (value, tid))
        _audit(c, tid, "info", b.model_dump(exclude_unset=True))
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
        if c.execute("SELECT 1 FROM stages WHERE tournament_id=? AND ord>1", (tid,)).fetchone():
            raise HTTPException(409, "Vòng bảng đã khóa sau khi lập chung kết")
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
    swiss_rounds: int | None = Field(default=None, ge=1)


@router.patch("/groups/{gid}")
def rename_group(gid: int, b: GroupUpdate):
    if b.name is not None and not b.name.strip():
        raise HTTPException(400, "Tên bảng không được trống")
    if "format" in b.model_fields_set and b.format not in ("round_robin", "swiss"):
        raise HTTPException(400, "Thể thức bảng không hợp lệ")
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        info = _group(c, gid, active=True)
        if "swiss_rounds" in b.model_fields_set:
            if (b.format or info["format"]) != "swiss" or c.execute("SELECT 1 FROM pairings WHERE group_id=?", (gid,)).fetchone():
                raise HTTPException(409, "Chỉ chốt số vòng Swiss trước khi ghép vòng 1")
            c.execute("UPDATE groups SET swiss_rounds=? WHERE id=?", (b.swiss_rounds, gid))
            _audit(c, info["tournament_id"], "swiss_rounds", {"group_id": gid, "rounds": b.swiss_rounds})
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
        c.execute("BEGIN IMMEDIATE")
        t = c.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
        if not t:
            raise HTTPException(404)
        gs = c.execute(
            "SELECT g.id,g.name,s.ord,s.format FROM groups g JOIN stages s ON s.id=g.stage_id "
            "WHERE s.tournament_id=? ORDER BY s.ord,g.id",
            (tid,),
        ).fetchall()
        if t["kind"] != "arena":
            if not gs:
                raise HTTPException(409, "Giải chưa có bảng thi đấu")
            for g in gs:
                _complete_group(c, _group(c, g["id"]))
        c.execute("UPDATE tournaments SET status='finished' WHERE id=?", (tid,))
        _audit(c, tid, "finish", {"previous_status": t["status"]})
        names = {r["id"]: r["name"] for r in c.execute("SELECT id,name FROM students")}
        out = []
        for g in gs:
            rows = c.execute(
                "SELECT white_id,black_id,result,round FROM pairings WHERE group_id=?", (g["id"],)
            ).fetchall()
            st = _table(c, _group(c, g["id"]), rows)
            for s in st:
                s["name"] = names.get(s["student_id"])
            champion = None
            if g["format"] == "knockout":
                champion = names.get(_champion(rows))
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
            st = _table(c, _group(c, g["id"]), rows)
            for s in st:
                s["name"] = names.get(s["student_id"])
            out.append({
                "group_id": g["id"],
                "name": g["name"],
                "ord": g["ord"],
                "format": g["format"],
                "standings": st,
                "champion": names.get(_champion(rows)) if g["format"] == "knockout" else None,
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
    if not b.name.strip():
        raise HTTPException(400, "Tên đấu trường không được trống")
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
        c.execute("BEGIN IMMEDIATE")
        t = c.execute("SELECT * FROM tournaments WHERE id=? AND kind='arena'", (tid,)).fetchone()
        if not t:
            raise HTTPException(404, "Không tìm thấy đấu trường")
        if t["status"] == "finished":
            raise HTTPException(409, "Đấu trường đã kết thúc")
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
        c.execute("BEGIN IMMEDIATE")
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
        c.execute("BEGIN IMMEDIATE")
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
                if end.tzinfo is None:
                    end = end.replace(tzinfo=datetime.now().astimezone().tzinfo)
                if datetime.now().astimezone() >= end:
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
            for r in c.execute("SELECT white_id,black_id,result FROM pairings WHERE group_id=? ORDER BY round,board", (gid,))
        ]
        ratings = {
            r["id"]: r["rating"]
            for r in c.execute("SELECT id,rating FROM students")
        }
        rnd = pairing.arena_pair(waiting, hist, ratings, seed=t["seed"] or 0)
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
        _audit(c, tid, "pair_arena", {"round": nxt, "boards": boards})
    return {"paired": paired, "round": nxt, "boards": boards}


@router.put("/arenas/pairings/{pid}")
def arena_set_result(pid: int, b: Result):
    """Nhập/sửa kết quả ván arena và lưu chỉ số kỹ thuật/chiến thuật."""
    with conn() as c:
        c.execute("BEGIN IMMEDIATE")
        p = _update_pairing_result(c, pid, b, arena_only=True)
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
            st = pairing.standings([tuple(r) for r in hist], "arena", [p["student_id"] for p in players])
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
