"""Immutable teacher worksheet versions; answers live in the snapshot, not in the current bank."""
import hashlib
import json
import uuid
from pydantic import BaseModel, Field


class Rename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def canonical(document):
    return json.dumps(document,ensure_ascii=False,sort_keys=True,separators=(',',':'))


def digest(document):
    return hashlib.sha256(canonical(document).encode()).hexdigest()


def valid_id(value):
    try:
        if str(uuid.UUID(value)) != value:
            raise ValueError
    except (ValueError,AttributeError,TypeError) as exc:
        raise ValueError("Mã đề hoặc yêu cầu không hợp lệ") from exc
    return value


def store(db, document_id, document, action, request_id=None, request_hash=None):
    valid_id(document_id)
    if request_id:
        valid_id(request_id)
    encoded = canonical(document)
    fingerprint = digest(document)
    db.execute("INSERT INTO worksheets(id,title,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET "
               "title=excluded.title,payload=excluded.payload,updated_at=strftime('%Y-%m-%d %H:%M:%f','now')",
               (document_id,document['title'],encoded))
    last = db.execute("SELECT id,fingerprint FROM worksheet_versions WHERE document_id=? ORDER BY id DESC LIMIT 1",(document_id,)).fetchone()
    # Repeated save/student-PDF/answer-PDF of the same content needs only one snapshot.
    if not request_id and last and last['fingerprint']==fingerprint:
        return last['id']
    exercises = document['exercises']
    cursor = db.execute("INSERT INTO worksheet_versions(document_id,title,kind,level,count,answer_count,search_text,payload,fingerprint,action,request_id,request_hash) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                        (document_id,document['title'],document['kind'],document['level'],len(exercises),
                         sum(bool(e['solution']) for e in exercises),
                         (document['title']+' '+document['level']).casefold(),encoded,fingerprint,action,request_id,request_hash))
    return cursor.lastrowid
