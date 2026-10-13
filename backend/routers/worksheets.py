import json
import uuid
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from db import conn
from services import worksheets as service
from services import worksheet_history as history

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


@router.post("/generate")
def generate(body: service.Generation):
    try:
        history.valid_id(body.document_id)
        history.valid_id(body.request_id)
        request_hash = history.digest(body.model_dump())
        if body.mode == "replace" and (body.index is None or body.index >= len(body.document.exercises) or body.selection.count != 1):
            raise ValueError("Chọn đúng một bài để thay")
        if body.mode == "append" and len(body.document.exercises) + body.selection.count > 120:
            raise ValueError("Mỗi đề tối đa 120 bài")
        with conn() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM worksheet_versions WHERE request_id=?",(body.request_id,)).fetchone()
            if existing:
                if existing['document_id'] != body.document_id or existing['request_hash'] != request_hash:
                    raise HTTPException(409,"Mã yêu cầu đã được dùng cho nội dung khác")
                return {"id":body.document_id,"version_id":existing['id'],"document":json.loads(existing['payload'])}
            document = service.validate_document(body.document)
            # Preserve unsaved edits before a successful replacement; a shortage rolls back both writes.
            if document['exercises']:
                history.store(db,body.document_id,document,"before_generate")
            selection = body.selection.model_copy(update={"exclude":[] if body.mode == "generate" else [e['id'] for e in document['exercises']]})
            chosen = service.select_exercises(selection)
            if body.mode == "replace":
                document['exercises'][body.index] = chosen[0]
            elif body.mode == "append":
                document['exercises'].extend(chosen)
            else:
                document['exercises'] = chosen
            document['filters'] = service.Filters(**body.selection.model_dump()).model_dump()
            document = service.validate_document(service.Document(**document))
            version = history.store(db,body.document_id,document,body.mode,body.request_id,request_hash)
        return {"id":body.document_id,"version_id":version,"document":document}
    except ValueError as exc:
        raise HTTPException(409,str(exc)) from exc


@router.get("/history")
def list_history(q: str = Query(default="",max_length=120), offset: int = Query(default=0,ge=0), limit: int = Query(default=12,ge=1,le=50)):
    search = service.clean_text(q).casefold()
    with conn() as db:
        total = db.execute("SELECT COUNT(*) FROM worksheet_versions WHERE instr(search_text,?)>0",(search,)).fetchone()[0]
        rows = db.execute("SELECT id,document_id,title,kind,level,count,answer_count,action,created_at FROM worksheet_versions "
                          "WHERE instr(search_text,?)>0 ORDER BY id DESC LIMIT ? OFFSET ?",(search,limit,offset)).fetchall()
    return {"items":[dict(r) for r in rows],"total":total,"offset":offset,"limit":limit}


@router.post("/edit")
def edit(body: service.Edit):
    try:
        history.valid_id(body.document_id)
        document = service.validate_document(body.document)
        exercise = service.validate_exercise(body.exercise)
        if body.index is not None and body.index >= len(document['exercises']):
            raise ValueError("Không tìm thấy bài cần sửa")
        if body.index is None and len(document['exercises']) >= 120:
            raise ValueError("Mỗi đề tối đa 120 bài")
        with conn() as db:
            db.execute("BEGIN IMMEDIATE")
            if document['exercises']:
                history.store(db,body.document_id,document,"before_edit")
            if body.index is None:
                document['exercises'].append(exercise)
            else:
                document['exercises'][body.index] = exercise
            version = history.store(db,body.document_id,document,"edit")
        return {"id":body.document_id,"document":document,"exercise":exercise,"version_id":version}
    except ValueError as exc:
        raise HTTPException(400,str(exc)) from exc


@router.get("/history/{version_id}")
def historical_document(version_id: int):
    with conn() as db:
        row = db.execute("SELECT * FROM worksheet_versions WHERE id=?",(version_id,)).fetchone()
    if not row:
        raise HTTPException(404,"Không tìm thấy phiên bản đề")
    return {"id":row['document_id'],"version_id":row['id'],"document":json.loads(row['payload']),"created_at":row['created_at']}


@router.get("/history/{version_id}/pdf")
def historical_pdf(version_id: int, answers: bool = False):
    snapshot = historical_document(version_id)
    return _pdf_response(snapshot['document'],answers)


@router.post("/validate")
def validate(body: service.Exercise):
    try:
        exercise = service.validate_exercise(body)
        return {"exercise": exercise, "svg": service.board_svg(exercise)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/pdf")
def export(body: service.Document, answers: bool = False, document_id: str | None = None):
    try:
        if document_id is not None:
            history.valid_id(document_id)
        document = service.validate_document(body, exporting=True)
        response = _pdf_response(document,answers)
        if document_id is not None:
            with conn() as db:
                db.execute("BEGIN IMMEDIATE")
                version = history.store(db,document_id,document,"export")
            response.headers['X-Worksheet-Version'] = str(version)
        return response
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _pdf_response(document, answers):
    try:
        document = service.validate_document(service.Document(**document),exporting=True)
        if answers and any(not e["solution"] for e in document["exercises"]):
            raise ValueError("Có bài chưa nhập đáp án. Bổ sung đáp án trước khi xuất bản giáo viên.")
        from services.worksheet_pdf import render_pdf
        pdf = render_pdf(document, answers=answers)
    except ValueError as exc:
        raise HTTPException(400,str(exc)) from exc
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
        db.execute("BEGIN IMMEDIATE")
        version = history.store(db,document_id,document,"save")
    return {"id": document_id, "document": document,"version_id":version}


@router.get("/{document_id}")
def load(document_id: str):
    with conn() as db:
        row = db.execute("SELECT payload FROM worksheets WHERE id=?", (document_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy đề đã lưu")
    return {"id": document_id, "document": json.loads(row["payload"])}
