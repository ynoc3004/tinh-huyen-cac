"""Shared validation and lossless tournament exchange; no live database is migrated here."""
import json
from datetime import datetime, timezone
from fastapi import HTTPException

RESULTS = {"1-0", "0-1", "1/2"}
METRICS = ("white_technical_errors", "black_technical_errors", "white_tactics_created", "black_tactics_created")
META = ("venue", "organizer", "chief_arbiter", "time_control")


def inspect_group(g):
    issues, seen, rests, colors, active = [], set(), set(), {}, set()
    ids = set(g["ids"])
    if len(ids) != len(g["ids"]):
        issues.append("Danh sách kỳ thủ trùng mã")
    rows = sorted(g["pairings"], key=lambda p: (p["round"], p["board"]))
    rounds = sorted({p["round"] for p in rows})
    fmt = g["format"]
    if rounds != list(range(1, len(rounds) + 1)):
        issues.append("Số vòng phải liên tục từ vòng 1")
    if fmt == "round_robin" and len(rounds) > max(0, len(ids) - 1 + len(ids) % 2):
        issues.append("Vượt số vòng vòng tròn")
    if fmt == "swiss" and g.get("swiss_rounds") and len(rounds) > g["swiss_rounds"]:
        issues.append("Vượt số vòng Swiss đã chốt")
    expected_knockout = list(g["ids"])
    for rnd in rounds:
        ps = [p for p in rows if p["round"] == rnd]
        present, boards, byes = [], set(), 0
        for p in ps:
            if type(p["board"]) is not int or p["board"] < 1 or p["board"] in boards:
                issues.append(f"Vòng {rnd}: số bàn không hợp lệ hoặc bị trùng")
            boards.add(p["board"])
            w, b, result = p["white_id"], p["black_id"], p["result"]
            present.append(w)
            if b is None:
                byes += 1
                if result != "bye":
                    issues.append(f"Vòng {rnd}: kết quả ván nghỉ không hợp lệ")
                if fmt == "swiss" and w in rests:
                    issues.append(f"Vòng {rnd}: kỳ thủ nghỉ có điểm lần thứ hai")
                rests.add(w)
                continue
            present.append(b)
            if w == b:
                issues.append(f"Vòng {rnd}: kỳ thủ tự gặp chính mình")
            if result not in (None, "", *RESULTS):
                issues.append(f"Vòng {rnd}: kết quả không hợp lệ")
            key = tuple(sorted((w, b)))
            if fmt in ("swiss", "round_robin") and key in seen:
                issues.append(f"Vòng {rnd}: trùng đối thủ")
            seen.add(key)
            if fmt == "arena" and not result:
                for sid in (w, b):
                    if sid in active:
                        issues.append("Một kỳ thủ đang ở hai ván chưa hoàn thành")
                    active.add(sid)
            for sid, color in ((w, "w"), (b, "b")):
                cs = colors.setdefault(sid, [])
                cs.append(color)
                if fmt == "swiss" and p.get("pairing_source") != "arbiter" and (
                    abs(cs.count("w") - cs.count("b")) > 2 or "".join(cs[-3:]) in ("www", "bbb")
                ):
                    issues.append(f"Vòng {rnd}: vi phạm màu quân")
        if len(set(present)) != len(present):
            issues.append(f"Vòng {rnd}: một người xuất hiện ở hai bàn")
        if fmt != "arena" and any(sid not in ids for sid in present):
            issues.append(f"Vòng {rnd}: kỳ thủ ngoài danh sách")
        if fmt in ("swiss", "round_robin"):
            if len(present) != len(ids):
                issues.append(f"Vòng {rnd}: thiếu kỳ thủ")
            if byes != len(ids) % 2:
                issues.append(f"Vòng {rnd}: số lượt nghỉ không hợp lệ")
        if fmt == "arena" and byes:
            issues.append("Arena không có ván nghỉ được cộng điểm")
        if fmt == "knockout":
            if len(present) != len(expected_knockout) or any(sid not in expected_knockout for sid in present):
                issues.append(f"Vòng {rnd}: nhánh loại trực tiếp không khớp người thắng vòng trước")
            size = 1 << max(0, (len(ids) - 1).bit_length())
            if len(ps) != (size // 2 if rnd == 1 else len(expected_knockout) / 2) or rnd > 1 and byes:
                issues.append(f"Vòng {rnd}: số bàn/nhánh loại trực tiếp không hợp lệ")
            expected_knockout = [p["white_id"] if p["black_id"] is None or p["result"] == "1-0"
                                 else p["black_id"] if p["result"] == "0-1" else None for p in ps]
            if None in expected_knockout and rnd != rounds[-1]:
                issues.append(f"Vòng {rnd}: đã ghép vòng sau khi chưa phân định thắng thua")
    return list(dict.fromkeys(issues))


def export_snapshot(c, tid):
    row = c.execute("SELECT * FROM tournaments WHERE id=?", (tid,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy giải")
    t, involved = dict(row), set()
    t["groups"] = []
    for row in c.execute("SELECT g.*,s.ord,s.format FROM groups g JOIN stages s ON s.id=g.stage_id WHERE s.tournament_id=? ORDER BY s.ord,g.id", (tid,)):
        g = dict(row)
        g["ids"] = [r[0] for r in c.execute("SELECT student_id FROM tournament_players WHERE group_id=? UNION SELECT student_id FROM stage_players WHERE group_id=? ORDER BY student_id", (g["id"], g["id"]))]
        g["pairings"] = [dict(r) for r in c.execute("SELECT * FROM pairings WHERE group_id=? ORDER BY round,board", (g["id"],))]
        g["draw_order"] = json.loads(g["draw_order"]) if g.get("draw_order") else None
        involved.update(g["ids"])
        involved.update(sid for p in g["pairings"] for sid in (p["white_id"], p["black_id"]) if sid is not None)
        t["groups"].append(g)
    t["arenaPlayers"] = {str(r["student_id"]): r["status"] for r in c.execute("SELECT student_id,status FROM arena_players WHERE tournament_id=?", (tid,))}
    return {"schema": "tinh-huyen-cac/1", "exported_at": datetime.now(timezone.utc).isoformat(),
            "tournament": t, "students": [dict(r) for r in c.execute("SELECT * FROM students ORDER BY id") if r["id"] in involved],
            "events": [{**dict(r), "details": json.loads(r["details"])} for r in c.execute("SELECT id,action,details,at FROM tournament_events WHERE tournament_id=? ORDER BY id", (tid,))]}


def _int(value, minimum=1):
    if type(value) is not int or value < minimum or value > 9007199254740991:
        raise HTTPException(400, "Mã hoặc số nhập trong bản sao lưu không hợp lệ")
    return value


def _text(value, maximum=300, required=False):
    if not isinstance(value, str) or len(value) > maximum or required and not value.strip():
        raise HTTPException(400, "Thông tin trong bản sao lưu không hợp lệ")
    return value.strip()


def restore_snapshot(c, backup):
    """Create new IDs in the caller's transaction; failures roll back all inserts."""
    if not isinstance(backup, dict) or backup.get("schema") != "tinh-huyen-cac/1":
        raise HTTPException(400, "File sao lưu không đúng định dạng Tĩnh Huyền Các")
    if len(json.dumps(backup, ensure_ascii=False).encode()) > 1900000:
        raise HTTPException(413, "File sao lưu quá lớn")
    source, people = backup.get("tournament"), backup.get("students")
    if not isinstance(source, dict) or not isinstance(people, list) or not isinstance(source.get("groups"), list):
        raise HTTPException(400, "Danh sách trong bản sao lưu không hợp lệ")
    kind, status = source.get("kind"), source.get("status")
    if kind not in ("classic", "arena") or status not in ("prepare", "running", "finished"):
        raise HTTPException(400, "Loại hoặc trạng thái giải không hợp lệ")
    name = _text(source.get("name"), required=True)
    if len(name) > 285:
        name = name[:285]
    name += " (khôi phục)"
    meta = [_text(source.get(k) or "") for k in META]
    duration = _int(source.get("duration_min"), 5) if kind == "arena" else None
    if kind == "arena" and status == "running":
        status = "prepare"
    tid = c.execute("INSERT INTO tournaments(name,date,seed,split_mode,notes,kind,status,duration_min,venue,organizer,chief_arbiter,time_control) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (name, _text(source.get("date") or ""), _int(source.get("seed") or 0, 0), _text(source.get("split_mode") or "manual"),
                     _text(source.get("notes") or "", 20000), kind, status, duration, *meta)).lastrowid
    sm, gm, roster = {}, set(), set()
    for p in people:
        if not isinstance(p, dict):
            raise HTTPException(400, "Kỳ thủ trong file không hợp lệ")
        sid = _int(p.get("id"))
        if sid in sm:
            raise HTTPException(400, "File có kỳ thủ trùng mã")
        rating = _int(p["rating"], 0) if p.get("rating") is not None else None
        sm[sid] = c.execute("INSERT INTO students(name,rating,club,note) VALUES(?,?,?,?)", (_text(p.get("name"), 200, True), rating, _text(p.get("club") or "", 200) or None, _text(p.get("note") or "", 20000))).lastrowid
    for old in source["groups"]:
        if not isinstance(old, dict):
            raise HTTPException(400, "Dữ liệu bảng không hợp lệ")
        oid, fmt, order = _int(old.get("id")), old.get("format"), _int(old.get("ord"))
        ids, rows = old.get("ids"), old.get("pairings")
        if oid in gm or order not in (1, 2) or fmt not in ("round_robin", "swiss", "knockout", "arena") or not isinstance(ids, list) or not isinstance(rows, list):
            raise HTTPException(400, "Dữ liệu bảng không hợp lệ")
        gm.add(oid)
        if (kind == "arena") != (fmt == "arena"):
            raise HTTPException(400, "Thể thức không khớp loại giải")
        if any(type(sid) is not int or sid not in sm for sid in ids) or len(set(ids)) != len(ids):
            raise HTTPException(400, "Danh sách kỳ thủ của bảng không hợp lệ")
        if order == 1:
            if roster.intersection(ids):
                raise HTTPException(400, "Kỳ thủ ở hai bảng")
            roster.update(ids)
        limit = _int(old["swiss_rounds"]) if old.get("swiss_rounds") is not None else None
        method = old.get("pairing_method") or "app"
        if method not in ("app", "arbiter"):
            raise HTTPException(400, "Nguồn ghép cặp không hợp lệ")
        draw = old.get("draw_order")
        if draw is not None and (not isinstance(draw, list) or len(draw) != len(ids) or any(type(sid) is not int or sid not in ids for sid in draw) or len(set(draw)) != len(ids)):
            raise HTTPException(400, "Số bốc thăm Berger không hợp lệ")
        st = c.execute("SELECT id FROM stages WHERE tournament_id=? AND ord=? AND format=?", (tid, order, fmt)).fetchone()
        stage = st[0] if st else c.execute("INSERT INTO stages(tournament_id,ord,name,format) VALUES(?,?,?,?)", (tid, order, "Vòng bảng" if order == 1 else "Chung kết", fmt)).lastrowid
        gid = c.execute("INSERT INTO groups(stage_id,name,swiss_rounds,pairing_method,draw_order) VALUES(?,?,?,?,?)", (stage, _text(old.get("name"), 100, True), limit, method, json.dumps([sm[sid] for sid in draw]) if draw is not None else None)).lastrowid
        for seed, sid in enumerate(ids, 1):
            if order == 1:
                c.execute("INSERT INTO tournament_players VALUES(?,?,?)", (tid, sm[sid], gid))
            else:
                c.execute("INSERT INTO stage_players(group_id,student_id,seed) VALUES(?,?,?)", (gid, sm[sid], seed))
        normalized = []
        for p in rows:
            if not isinstance(p, dict):
                raise HTTPException(400, "Ván đấu trong file không hợp lệ")
            rnd, board, w = _int(p.get("round")), _int(p.get("board")), _int(p.get("white_id"))
            b, result = p.get("black_id"), p.get("result")
            if b is not None:
                _int(b)
            if w not in sm or b is not None and b not in sm or w == b or b is None and result != "bye" or b is not None and result not in (None, *RESULTS):
                raise HTTPException(400, "Ván đấu trong file không hợp lệ")
            metrics = [_int(p.get(k) or 0, 0) for k in METRICS]
            pairing_source = "arbiter" if p.get("pairing_source") == "arbiter" else None
            normalized.append({"round": rnd, "board": board, "white_id": w, "black_id": b, "result": result, "pairing_source": pairing_source})
            c.execute("INSERT INTO pairings(group_id,round,board,white_id,black_id,result,white_technical_errors,black_technical_errors,white_tactics_created,black_tactics_created,pairing_source) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                      (gid, rnd, board, sm[w], sm[b] if b is not None else None, result, *metrics, pairing_source))
        issues = inspect_group({**old, "pairings": normalized})
        if issues:
            raise HTTPException(400, "File sao lưu chứa lịch vi phạm: " + "; ".join(issues))
        if kind == "arena":
            for sid in ids:
                playing = any(not p["result"] and sid in (p["white_id"], p["black_id"]) for p in normalized)
                c.execute("INSERT INTO arena_players VALUES(?,?,?)", (tid, sm[sid], "playing" if playing else "waiting"))
    if kind == "arena" and len(source["groups"]) != 1:
        raise HTTPException(400, "Arena phải có một bảng")
    details = {"source_tournament_id": source.get("id"), "exported_at": backup.get("exported_at"), "source_events": backup.get("events", []), "note": "Khôi phục thành giải mới; không ghi đè dữ liệu hiện có."}
    c.execute("INSERT INTO tournament_events(tournament_id,action,details) VALUES(?,'restore',?)", (tid, json.dumps(details, ensure_ascii=False)))
    return {"tournament_id": tid, "restored": True}
