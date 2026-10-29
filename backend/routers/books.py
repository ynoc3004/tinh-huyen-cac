"""Manage study-book links independently of the encrypted local-file vault."""
import sqlite3
import uuid
import json

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from db import conn
from services.online_books import Book, fold, url_key

router = APIRouter(prefix='/api/books')


def get_row(db, book_id):
    row = db.execute('SELECT b.id,b.title,b.author,b.subject,b.description,b.url,b.created_at,b.updated_at, EXISTS(SELECT 1 FROM online_book_packages p WHERE p.book_id=b.id) AS offline FROM online_books b WHERE b.id=?', (book_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Không tìm thấy sách trong tủ.')
    return dict(row)


@router.get('')
def list_books(q: str = Query(default='', max_length=160)):
    with conn() as db:
        rows = [dict(row) for row in db.execute('SELECT b.id,b.title,b.author,b.subject,b.description,b.url,b.created_at,b.updated_at, EXISTS(SELECT 1 FROM online_book_packages p WHERE p.book_id=b.id) AS offline FROM online_books b ORDER BY b.created_at DESC,b.id')]
    needle = fold(q.strip())
    return [row for row in rows if needle in fold(' '.join(row[k] for k in ('title', 'author', 'subject', 'description')))]


@router.post('/import')
async def import_book(request: Request):
    from services.offline_books import MAX_UPLOAD, read_package
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_UPLOAD:
            raise HTTPException(413, 'Gói sách vượt quá 64 MB.')
        raw.extend(chunk)
    try:
        from starlette.concurrency import run_in_threadpool
        book, manifest, docs, assets = await run_in_threadpool(read_package, bytes(raw))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    with conn() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT id FROM online_books WHERE url_key=?', (url_key(book.url),)).fetchone()
        book_id = row['id'] if row else uuid.uuid4().hex
        if not row:
            db.execute('INSERT INTO online_books(id,title,author,subject,description,url,url_key) VALUES(?,?,?,?,?,?,?)',
                       (book_id,book.title,book.author,book.subject,book.description,book.url,url_key(book.url)))
        db.execute('INSERT INTO online_book_packages(book_id,manifest,content) VALUES(?,?,?) ON CONFLICT(book_id) DO UPDATE SET manifest=excluded.manifest,content=excluded.content,imported_at=CURRENT_TIMESTAMP',
                   (book_id,json.dumps(manifest,ensure_ascii=False),json.dumps(docs,ensure_ascii=False)))
        db.execute('DELETE FROM online_book_assets WHERE book_id=?', (book_id,))
        db.executemany('INSERT INTO online_book_assets(book_id,path,mime,data) VALUES(?,?,?,?)', [(book_id,*asset) for asset in assets])
        result = get_row(db,book_id)
    return {**result,'stats':{key:manifest[key] for key in ('chapters','pages','figures','pdf')}}


@router.get('/{book_id}/offline')
def offline_info(book_id: str):
    with conn() as db:
        book = get_row(db,book_id)
        row = db.execute('SELECT manifest FROM online_book_packages WHERE book_id=?', (book_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Chưa nhập nội dung ngoại tuyến cho sách này.')
    return {**json.loads(row['manifest']), 'title':book['title'], 'author':book['author']}


@router.get('/{book_id}/content/{name}')
def offline_content(book_id: str, name: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with conn() as db:
        row = db.execute('SELECT content FROM online_book_packages WHERE book_id=?', (book_id,)).fetchone()
    content = json.loads(row['content']) if row else {}
    if name not in content:
        raise HTTPException(404, 'Không tìm thấy nội dung chương đã lưu.')
    return content[name]


class TextCorrection(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    page: int = Field(ge=1, le=100000)
    block_index: int = Field(ge=0, le=2999)
    block_type: str = Field(pattern='^(p|h2|h3|moves|quote|test|figure)$')
    previous_text: str = Field(max_length=100000)
    text: str = Field(max_length=100000)


@router.patch('/{book_id}/content/{name}')
async def correct_text(book_id: str, name: str, request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 2000000:
            raise HTTPException(413, 'Đoạn sửa quá dài.')
    try:
        edit = TextCorrection.model_validate_json(raw)
    except ValidationError:
        raise HTTPException(422, 'Thông tin chỉnh sửa không hợp lệ. Mỗi đoạn tối đa 100.000 ký tự.')
    if edit.block_type != 'figure' and not edit.text.strip():
        raise HTTPException(422, 'Nội dung đoạn văn không được để trống.')
    with conn() as db:
        # Serialize read/modify/write so simultaneous corrections to other paragraphs survive.
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT content FROM online_book_packages WHERE book_id=?', (book_id,)).fetchone()
        docs = json.loads(row['content']) if row else {}
        catalog = docs.get('catalog.json', [])
        if not any(c['id'] + '.json' == name for c in catalog) or name not in docs:
            raise HTTPException(404, 'Không tìm thấy chương đã lưu.')
        chapter = docs[name]
        page = next((p for p in chapter['pages'] if p['page'] == edit.page), None)
        if page is None or edit.block_index >= len(page['blocks']):
            raise HTTPException(404, 'Không tìm thấy đoạn cần sửa. Hãy tải lại chương.')
        block = page['blocks'][edit.block_index]
        if block['type'] != edit.block_type or block.get('text', '') != edit.previous_text:
            raise HTTPException(409, 'Đoạn này đã thay đổi ở nơi khác. Bản sửa của bạn chưa được ghi đè. Hãy tải lại bản đã lưu để đối chiếu.')
        block['text'] = edit.text
        from services.offline_books import MAX_FILE, MAX_EXPANDED
        if len(json.dumps(chapter, ensure_ascii=False).encode()) > MAX_FILE:
            raise HTTPException(413, 'Chương quá lớn sau khi sửa.')
        content = json.dumps(docs, ensure_ascii=False)
        if len(content.encode()) > MAX_EXPANDED:
            raise HTTPException(413, 'Nội dung sách quá lớn sau khi sửa.')
        db.execute('UPDATE online_book_packages SET content=? WHERE book_id=?', (content, book_id))
        db.execute("UPDATE online_books SET updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?", (book_id,))
    return {'saved': True, 'page': edit.page, 'block_index': edit.block_index, 'text': edit.text}


@router.get('/{book_id}/asset/{path:path}')
def offline_asset(book_id: str, path: str):
    with conn() as db:
        row = db.execute('SELECT mime,data FROM online_book_assets WHERE book_id=? AND path=?', (book_id,path)).fetchone()
    if not row:
        raise HTTPException(404, 'Không tìm thấy hình hoặc tài liệu đã lưu.')
    return Response(bytes(row['data']),media_type=row['mime'],headers={'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-cache',
                    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'"})


@router.get('/{book_id}')
def get_book(book_id: str):
    with conn() as db:
        return get_row(db, book_id)


@router.post('', status_code=201)
def create_book(book: Book):
    book_id = uuid.uuid4().hex
    try:
        with conn() as db:
            db.execute('INSERT INTO online_books(id,title,author,subject,description,url,url_key) VALUES(?,?,?,?,?,?,?)',
                       (book_id, book.title, book.author, book.subject, book.description, book.url, url_key(book.url)))
            return get_row(db, book_id)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, 'Đường dẫn sách này đã có trong tủ. Hãy sửa quyển đã lưu.') from exc


@router.put('/{book_id}')
def update_book(book_id: str, book: Book):
    try:
        with conn() as db:
            current = get_row(db, book_id)
            if current['offline'] and url_key(current['url']) != url_key(book.url):
                raise HTTPException(409, 'Sách đã có nội dung ngoại tuyến. Giữ đường dẫn nguồn hiện tại; nhập gói khác thành sách mới nếu muốn đổi nội dung.')
            db.execute("UPDATE online_books SET title=?,author=?,subject=?,description=?,url=?,url_key=?,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?",
                       (book.title, book.author, book.subject, book.description, book.url, url_key(book.url), book_id))
            return get_row(db, book_id)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, 'Đường dẫn sách này đã có trong tủ. Hãy sửa quyển đã lưu.') from exc


@router.delete('/{book_id}')
def delete_book(book_id: str):
    with conn() as db:
        get_row(db, book_id)
        db.execute('DELETE FROM online_books WHERE id=?', (book_id,))
    return {'deleted_id': book_id}
