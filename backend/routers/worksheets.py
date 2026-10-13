import json
import uuid
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from db import conn
from services import worksheets as service

router = APIRouter(prefix="/api/worksheets")


@router.get("/options")
def options():
    return {"levels": service.LEVELS, "themes": service.THEMES, "bank": service.bank_info(), "per_page": 12}


@router.post("/select")
def select(body: service.Selection):
    try:
        return {"exercises": service.select_exercises(body)}
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/validate")
def validate(body: service.Exercise):
    try:
        exercise = service.validate_exercise(body)
        return {"exercise": exercise, "svg": service.board_svg(exercise)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/pdf")
def export(body: service.Document, answers: bool = False):
    try:
        document = service.validate_document(body, exporting=True)
        if answers and any(not e["solution"] for e in document["exercises"]):
            raise ValueError("Có bài chưa nhập đáp án. Bổ sung đáp án trước khi xuất bản giáo viên.")
        from services.worksheet_pdf import render_pdf
        pdf = render_pdf(document, answers=answers)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ImportError as exc:
        raise HTTPException(503, "Thiếu thư viện xuất PDF. Chạy python -m pip install -r requirements.txt rồi khởi động lại server.") from exc
    filename = "worksheet-answers.pdf" if answers else "worksheet-students.pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


@router.get("")
def list_documents():
    with conn() as db:
        rows = db.execute("SELECT id,title,payload,updated_at FROM worksheets ORDER BY updated_at DESC,id DESC").fetchall()
    return [{"id": r["id"], "title": r["title"], "updated_at": r["updated_at"],
             "count": len(json.loads(r["payload"])["exercises"])} for r in rows]


@router.put("/{document_id}")
def save(document_id: str, body: service.Document):
    try:
        if str(uuid.UUID(document_id)) != document_id:
            raise ValueError("Mã đề không hợp lệ")
        document = service.validate_document(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    with conn() as db:
        db.execute("INSERT INTO worksheets(id,title,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET "
                   "title=excluded.title,payload=excluded.payload,updated_at=strftime('%Y-%m-%d %H:%M:%f','now')",
                   (document_id, document["title"], json.dumps(document, ensure_ascii=False)))
    return {"id": document_id, "document": document}


@router.get("/{document_id}")
def load(document_id: str):
    with conn() as db:
        row = db.execute("SELECT payload FROM worksheets WHERE id=?", (document_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy đề đã lưu")
    return {"id": document_id, "document": json.loads(row["payload"])}
