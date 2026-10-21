"""Manage study-book links independently of the encrypted local-file vault."""
import sqlite3
import uuid

from fastapi import APIRouter, HTTPException, Query
from db import conn
from services.online_books import Book, fold, url_key

router = APIRouter(prefix='/api/books')


def get_row(db, book_id):
    row = db.execute('SELECT id,title,author,subject,description,url,created_at,updated_at FROM online_books WHERE id=?', (book_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Không tìm thấy sách trong tủ.')
    return dict(row)


@router.get('')
def list_books(q: str = Query(default='', max_length=160)):
    with conn() as db:
        rows = [dict(row) for row in db.execute('SELECT id,title,author,subject,description,url,created_at,updated_at FROM online_books ORDER BY created_at DESC,id')]
    needle = fold(q.strip())
    return [row for row in rows if needle in fold(' '.join(row[k] for k in ('title', 'author', 'subject', 'description')))]


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
            get_row(db, book_id)
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
