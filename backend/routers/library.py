import json
import mimetypes
import os
import secrets
import threading
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import DATA
from config import LIBRARY_DIR as _DEFAULT_DIR
from db import conn
from services import vault

router = APIRouter(prefix="/api/library")

KIND = {".pdf": "book", ".epub": "book", ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
        ".pgn": "doc", ".txt": "doc", ".md": "doc", ".docx": "doc"}

LINK_FILE = DATA / "library_link.json"
META_NAME = ".thc-vault.json"
BLOB_DIR = "vault"
COOKIE = "thc_vault"
IDLE_SEC = max(1, int(os.getenv("VAULT_IDLE_MIN", "15"))) * 60
MAX_BYTES = int(os.getenv("VAULT_MAX_MB", "2048")) * 1024 * 1024
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}
HOSTS = {"127.0.0.1", "localhost", "::1", "testserver"}


def _initial_dir() -> Path:
    """Thư mục liên kết: file data/library_link.json > biến LIBRARY_DIR > data/library."""
    try:
        p = Path(json.loads(LINK_FILE.read_text(encoding="utf-8"))["path"])
        if p.is_dir():
            return p
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return Path(_DEFAULT_DIR)


LIBRARY_DIR = _initial_dir()

_mu = threading.Lock()
_state = {"key": None, "sessions": {}, "fails": 0, "blocked_until": 0.0}


def reset_state():
    with _mu:
        _state.update(key=None, sessions={}, fails=0, blocked_until=0.0)


# ---------------------------------------------------------------- tiện ích

def fold(t):
    """Bỏ dấu tiếng Việt và chữ hoa để tìm kiếm không phân biệt dấu."""
    t = unicodedata.normalize("NFD", str(t or "").replace("đ", "d").replace("Đ", "D"))
    return "".join(ch for ch in t if not unicodedata.combining(ch)).lower()


def _meta_path() -> Path:
    return Path(LIBRARY_DIR) / META_NAME


def _blob_dir() -> Path:
    return Path(LIBRARY_DIR) / BLOB_DIR


def _inside_library(path):
    path = Path(path).resolve()
    if not path.is_relative_to(Path(LIBRARY_DIR).resolve()):
        raise HTTPException(403, "Đường dẫn phải nằm trong thư mục đã liên kết")
    return path


def _local(request: Request):
    """Chỉ cho phép truy cập từ chính máy này (chống mở từ máy khác trong LAN và DNS rebinding)."""
    if os.getenv("ALLOW_REMOTE_VAULT") == "1":
        return
    host = request.client.host if request.client else ""
    h = request.headers.get("host") or ""
    h = h[1:h.index("]")] if h.startswith("[") and "]" in h else h.split(":")[0]
    if host not in LOOPBACK or h not in HOSTS:
        raise HTTPException(403, "Tàng Kinh Các chỉ mở được từ website chạy trên chính máy này (localhost)")


def _purge(now):
    s = _state["sessions"]
    for t in [t for t, seen in s.items() if now - seen > IDLE_SEC]:
        del s[t]
    if not s:
        _state["key"] = None


def _session_key(request: Request, touch: bool):
    with _mu:
        now = time.monotonic()
        _purge(now)
        tok = request.cookies.get(COOKIE)
        if tok and tok in _state["sessions"] and _state["key"]:
            if touch:
                _state["sessions"][tok] = now
            return _state["key"]
    return None


def guard(request: Request) -> bytes:
    _local(request)
    key = _session_key(request, touch=True)
    if key is None:
        raise HTTPException(401, "Tàng Kinh Các đang khóa")
    return key


def _open_session(response: Response, key: bytes):
    tok = secrets.token_urlsafe(32)
    with _mu:
        _state["key"] = key
        _state["sessions"][tok] = time.monotonic()
        _state["fails"] = 0
    response.set_cookie(COOKIE, tok, httponly=True, samesite="strict", path="/api/library")


# ---------------------------------------------------------------- két: trạng thái / liên kết / mật khẩu

class Pw(BaseModel):
    password: str


class PwChange(BaseModel):
    old: str
    new: str


class Link(BaseModel):
    path: str


@router.get("/vault/status")
def vault_status(request: Request):
    _local(request)
    return {
        "folder": str(LIBRARY_DIR),
        "initialized": _meta_path().is_file(),
        "unlocked": _session_key(request, touch=False) is not None,
        "idle_min": IDLE_SEC // 60,
    }


@router.post("/vault/link")
def vault_link(b: Link, request: Request):
    global LIBRARY_DIR
    _local(request)
    raw = b.path.strip().strip('"')
    if not raw:
        raise HTTPException(400, "Nhập đường dẫn thư mục")
    target = Path(os.path.expandvars(os.path.expanduser(raw)))
    try:
        target.mkdir(parents=True, exist_ok=True)
        target = target.resolve()
    except OSError as e:
        raise HTTPException(400, f"Không dùng được thư mục này: {e.strerror or e}")
    if not target.is_dir():
        raise HTTPException(400, "Đường dẫn không phải thư mục")
    reset_state()  # đổi thư mục thì khóa lại
    LIBRARY_DIR = target
    try:
        LINK_FILE.write_text(json.dumps({"path": str(target)}), encoding="utf-8")
    except OSError as e:
        raise HTTPException(500, f"Không lưu được liên kết: {e.strerror or e}")
    return {"folder": str(target), "initialized": _meta_path().is_file()}


@router.post("/vault/setup")
def vault_setup(b: Pw, request: Request, response: Response):
    _local(request)
    if _meta_path().is_file():
        raise HTTPException(409, "Thư mục này đã có két. Hãy mở khóa bằng mật khẩu.")
    if len(b.password) < vault.MIN_PASSWORD:
        raise HTTPException(400, f"Mật khẩu cần ít nhất {vault.MIN_PASSWORD} ký tự")
    Path(LIBRARY_DIR).mkdir(parents=True, exist_ok=True)
    meta, key = vault.create_meta(b.password)
    vault.write_meta(_meta_path(), meta)
    _open_session(response, key)
    return {"ok": True}


@router.post("/vault/unlock")
def vault_unlock(b: Pw, request: Request, response: Response):
    _local(request)
    with _mu:
        wait = int(_state["blocked_until"] - time.monotonic())
    if wait > 0:
        raise HTTPException(429, f"Nhập sai nhiều lần. Thử lại sau {wait} giây.")
    meta = vault.read_meta(_meta_path())
    if meta is None:
        raise HTTPException(404, "Thư mục này chưa có két. Hãy đặt mật khẩu trước.")
    try:
        key = vault.unlock_meta(meta, b.password)
    except vault.WrongPassword:
        with _mu:
            _state["fails"] += 1
            if _state["fails"] >= 5:
                _state["blocked_until"] = time.monotonic() + min(300, 5 * 2 ** (_state["fails"] - 5))
        raise HTTPException(401, "Sai mật khẩu")
    _open_session(response, key)
    return {"ok": True}


@router.post("/vault/lock")
def vault_lock(request: Request, response: Response):
    _local(request)
    reset_state()
    response.delete_cookie(COOKIE, path="/api/library")
    return {"ok": True}


@router.post("/vault/password")
def vault_password(b: PwChange, key: bytes = Depends(guard)):
    if len(b.new) < vault.MIN_PASSWORD:
        raise HTTPException(400, f"Mật khẩu mới cần ít nhất {vault.MIN_PASSWORD} ký tự")
    meta = vault.read_meta(_meta_path())
    try:
        vault.unlock_meta(meta, b.old)
    except (vault.WrongPassword, TypeError, KeyError):
        raise HTTPException(401, "Mật khẩu hiện tại không đúng")
    vault.write_meta(_meta_path(), vault.rewrap_meta(meta, key, b.new))
    return {"ok": True}


# ---------------------------------------------------------------- lưu file vào két

def _new_blob():
    d = _blob_dir()
    d.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(16) + ".thc"
    return name, d / name


def _hmac_of_blob(key, blob_path):
    h = vault.new_hmac(key)
    with open(blob_path, "rb") as f:
        for part in vault.decrypt_iter(key, f):
            h.update(part)
    return h.hexdigest()


def _insert_or_dedupe(c, name, dest, digest, size, title, ext, legacy_path=None):
    """Trả về 'added' | 'converted' | 'duplicate'. Với 'duplicate' blob mới bị xóa."""
    if c.execute("SELECT 1 FROM library_items WHERE sha1=? AND blob IS NOT NULL", (digest,)).fetchone():
        dest.unlink(missing_ok=True)
        return "duplicate"
    if legacy_path:
        row = c.execute("SELECT id FROM library_items WHERE path=? AND blob IS NULL", (legacy_path,)).fetchone()
        if row:
            c.execute("UPDATE library_items SET blob=?,path=?,sha1=?,size=?,ext=? WHERE id=?",
                      (name, "vault:" + name, digest, size, ext, row["id"]))
            return "converted"
    c.execute("INSERT INTO library_items(kind,title,path,ext,size,sha1,blob) VALUES(?,?,?,?,?,?,?)",
              (KIND[ext], title, "vault:" + name, ext, size, digest, name))
    return "added"


class Scan(BaseModel):
    path: str | None = None
    delete_original: bool = False


@router.post("/scan")
def scan(body: Scan, key: bytes = Depends(guard)):
    """Mã hóa các file còn nằm ở dạng thường trong thư mục liên kết rồi đưa vào két."""
    root = _inside_library(body.path or LIBRARY_DIR)
    if not root.is_dir():
        raise HTTPException(400, "Thư mục không tồn tại")
    lib = Path(LIBRARY_DIR).resolve()
    vdir = _blob_dir().resolve()
    out = {"added": 0, "converted": 0, "duplicate": 0, "deleted": 0, "failed": 0, "seen": 0}
    with conn() as c:
        for p in sorted(root.rglob("*")):
            dest = None
            try:
                if p.is_symlink() or not p.is_file() or p.suffix.lower() not in KIND:
                    continue
                rp = p.resolve()
                if not rp.is_relative_to(lib) or rp.is_relative_to(vdir):
                    continue
                if any(part.startswith(".") for part in rp.relative_to(lib).parts):
                    continue
                out["seen"] += 1
                name, dest = _new_blob()
                h, size = vault.new_hmac(key), 0
                with open(rp, "rb") as src, open(dest, "wb") as o:
                    enc = vault.Encryptor(key, o)
                    for chunk in iter(lambda: src.read(1 << 20), b""):
                        h.update(chunk)
                        enc.write(chunk)
                        size += len(chunk)
                    enc.finish()
                digest = h.hexdigest()
                # Chỉ xóa bản gốc khi đã giải mã thử bản mã hóa và khớp từng byte.
                if body.delete_original and _hmac_of_blob(key, dest) != digest:
                    dest.unlink(missing_ok=True)
                    out["failed"] += 1
                    continue
                res = _insert_or_dedupe(c, name, dest, digest, size, rp.stem, rp.suffix.lower(), str(rp))
                out[res] += 1
                if body.delete_original:
                    rp.unlink()
                    out["deleted"] += 1
            except (OSError, ValueError):
                if dest is not None:
                    dest.unlink(missing_ok=True)
                out["failed"] += 1
    return out


@router.post("/import")
async def import_file(request: Request, name: str, folder: int = 0, key: bytes = Depends(guard)):
    """Nhận file thô từ trình duyệt (body là nội dung file), mã hóa ngay khi nhận."""
    fname = Path(name.replace("\\", "/")).name
    ext = Path(fname).suffix.lower()
    if ext not in KIND:
        raise HTTPException(400, "Định dạng không hỗ trợ: " + (ext or fname))
    if folder:
        with conn() as c:
            if not c.execute("SELECT 1 FROM library_folders WHERE id=?", (folder,)).fetchone():
                raise HTTPException(404, "Thư mục đích không tồn tại")
    bname, dest = _new_blob()
    h, size = vault.new_hmac(key), 0
    try:
        with open(dest, "wb") as o:
            enc = vault.Encryptor(key, o)
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "File quá lớn")
                h.update(chunk)
                enc.write(chunk)
            enc.finish()
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    with conn() as c:
        res = _insert_or_dedupe(c, bname, dest, h.hexdigest(), size, Path(fname).stem[:200], ext)
        if res == "added" and folder:
            c.execute("UPDATE library_items SET folder_id=? WHERE blob=?", (folder, bname))
    return {"result": res}


# ---------------------------------------------------------------- danh sách / chi tiết

@router.get("")
def items(kind: str | None = None, tag: str | None = None, q: str | None = None, favorite: bool = False,
          sort: str = "new", folder: int | None = None, key: bytes = Depends(guard)):
    """folder: bỏ trống = mọi thư mục (dùng khi tìm kiếm); 0 = gốc; số khác = id thư mục."""
    sql, a = ("SELECT i.*, (SELECT GROUP_CONCAT(g.name, ',') FROM library_item_tags t JOIN library_tags g "
              "ON g.id=t.tag_id WHERE t.item_id=i.id) AS tags FROM library_items i WHERE i.blob IS NOT NULL"), []
    if folder is not None:
        if folder == 0: sql += " AND i.folder_id IS NULL"
        else: sql += " AND i.folder_id=?"; a.append(folder)
    if kind: sql += " AND kind=?"; a.append(kind)
    if favorite: sql += " AND favorite=1"
    if tag: sql += " AND id IN (SELECT item_id FROM library_item_tags t JOIN library_tags g ON g.id=t.tag_id WHERE g.name=?)"; a.append(tag)
    order = {"name": "title COLLATE NOCASE ASC", "old": "added_at ASC, id ASC"}.get(sort, "added_at DESC, id DESC")
    with conn() as c:
        rows = [dict(r) for r in c.execute(sql + " ORDER BY " + order, a)]
    if q:
        needle = fold(q).strip()
        rows = [r for r in rows if needle in fold(r["title"]) or needle in fold(r["note"])]
    if sort == "name":
        rows.sort(key=lambda r: fold(r["title"]))
    for r in rows:  # không lộ đường dẫn trên ổ đĩa
        for k in ("path", "blob", "sha1"):
            r.pop(k, None)
    return rows


# ---------------------------------------------------------------- thư mục (ảo, lưu trong database)

def _clean_name(name: str) -> str:
    n = " ".join(str(name or "").replace("\\", "/").split("/")[-1].split()).strip(". ")
    if not n:
        raise HTTPException(400, "Tên không được để trống")
    return n[:120]


def _folder(c, fid):
    r = c.execute("SELECT * FROM library_folders WHERE id=?", (fid,)).fetchone()
    if not r:
        raise HTTPException(404, "Thư mục không tồn tại")
    return r


def _subtree(c, fid):
    """id của thư mục và mọi thư mục con."""
    return [r[0] for r in c.execute(
        "WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT f.id FROM library_folders f JOIN t ON f.parent_id=t.id) "
        "SELECT id FROM t", (fid,))]


def _no_dup(c, parent, name, exclude=None):
    q = "SELECT 1 FROM library_folders WHERE parent_id IS ? AND name=? COLLATE NOCASE"
    a = [parent, name]
    if exclude:
        q += " AND id<>?"; a.append(exclude)
    if c.execute(q, a).fetchone():
        raise HTTPException(409, f"Đã có thư mục tên “{name}” ở đây")


class FolderNew(BaseModel):
    name: str
    parent_id: int | None = None


class FolderPatch(BaseModel):
    name: str | None = None
    parent_id: int | None = None  # chỉ có tác dụng khi được gửi: null/0 = gốc


class Move(BaseModel):
    item_ids: list[int]
    folder_id: int | None = None


class Bulk(BaseModel):
    item_ids: list[int]


@router.get("/folders")
def folders(key: bytes = Depends(guard)):
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT f.id, f.parent_id, f.name, (SELECT COUNT(*) FROM library_items i WHERE i.folder_id=f.id AND i.blob IS NOT NULL) AS files "
            "FROM library_folders f ORDER BY f.name COLLATE NOCASE")]
        root = c.execute("SELECT COUNT(*) FROM library_items WHERE folder_id IS NULL AND blob IS NOT NULL").fetchone()[0]
    rows.sort(key=lambda r: fold(r["name"]))
    return {"folders": rows, "root_files": root}


@router.post("/folders")
def folder_create(b: FolderNew, key: bytes = Depends(guard)):
    name, parent = _clean_name(b.name), b.parent_id or None
    with conn() as c:
        if parent:
            _folder(c, parent)
        _no_dup(c, parent, name)
        cur = c.execute("INSERT INTO library_folders(parent_id,name) VALUES(?,?)", (parent, name))
        return {"id": cur.lastrowid, "name": name, "parent_id": parent}


@router.patch("/folders/{fid}")
def folder_patch(fid: int, b: FolderPatch, key: bytes = Depends(guard)):
    with conn() as c:
        cur = _folder(c, fid)
        name = _clean_name(b.name) if b.name is not None else cur["name"]
        parent = (b.parent_id or None) if "parent_id" in b.model_fields_set else cur["parent_id"]
        if parent:
            _folder(c, parent)
            if parent in _subtree(c, fid):
                raise HTTPException(400, "Không thể chuyển thư mục vào chính nó hoặc thư mục con của nó")
        _no_dup(c, parent, name, exclude=fid)
        c.execute("UPDATE library_folders SET name=?, parent_id=? WHERE id=?", (name, parent, fid))
    return {"ok": True}


@router.delete("/folders/{fid}")
def folder_delete(fid: int, contents: str = "keep", key: bytes = Depends(guard)):
    """contents=keep: file và thư mục con được chuyển lên thư mục cha. contents=delete: xóa luôn mọi file bên trong."""
    if contents not in ("keep", "delete"):
        raise HTTPException(400, "contents phải là keep hoặc delete")
    blobs = []
    with conn() as c:
        cur = _folder(c, fid)
        if contents == "delete":
            ids = _subtree(c, fid)
            ph = ",".join("?" * len(ids))
            blobs = [r[0] for r in c.execute(f"SELECT blob FROM library_items WHERE folder_id IN ({ph}) AND blob IS NOT NULL", ids)]
            c.execute(f"DELETE FROM library_items WHERE folder_id IN ({ph})", ids)
            c.execute("DELETE FROM library_folders WHERE id=?", (fid,))  # thư mục con xóa theo (ON DELETE CASCADE)
        else:
            parent = cur["parent_id"]
            for r in c.execute("SELECT id, name FROM library_folders WHERE parent_id=?", (fid,)).fetchall():
                _no_dup(c, parent, r["name"])  # tránh trùng tên khi nhấc lên cấp trên
            c.execute("UPDATE library_folders SET parent_id=? WHERE parent_id=?", (parent, fid))
            c.execute("UPDATE library_items SET folder_id=? WHERE folder_id=?", (parent, fid))
            c.execute("DELETE FROM library_folders WHERE id=?", (fid,))
    for bl in blobs:
        (_blob_dir() / Path(bl).name).unlink(missing_ok=True)
    return {"ok": True, "deleted_files": len(blobs)}


@router.post("/move")
def move_items(b: Move, key: bytes = Depends(guard)):
    fid = b.folder_id or None
    with conn() as c:
        if fid:
            _folder(c, fid)
        for i in set(b.item_ids):
            c.execute("UPDATE library_items SET folder_id=? WHERE id=? AND blob IS NOT NULL", (fid, i))
    return {"ok": True}


@router.post("/delete-many")
def delete_many(b: Bulk, key: bytes = Depends(guard)):
    blobs = []
    with conn() as c:
        for i in set(b.item_ids):
            r = c.execute("SELECT blob FROM library_items WHERE id=?", (i,)).fetchone()
            if r:
                c.execute("DELETE FROM library_items WHERE id=?", (i,))
                if r["blob"]:
                    blobs.append(r["blob"])
    for bl in blobs:
        (_blob_dir() / Path(bl).name).unlink(missing_ok=True)
    return {"ok": True, "deleted": len(blobs)}


@router.get("/tags")
def tags(key: bytes = Depends(guard)):
    with conn() as c:
        return [r["name"] for r in c.execute(
            "SELECT g.name FROM library_tags g JOIN library_item_tags t ON t.tag_id=g.id GROUP BY g.id ORDER BY COUNT(*) DESC")]


class Patch(BaseModel):
    favorite: bool | None = None
    note: str | None = None
    title: str | None = None
    add_tag: str | None = None
    remove_tag: str | None = None
    folder_id: int | None = None  # có gửi trường này: null/0 = đưa về gốc, số = chuyển vào thư mục đó


@router.patch("/{item_id}")
def patch(item_id: int, b: Patch, key: bytes = Depends(guard)):
    if b.title is not None:
        b.title = _clean_name(b.title)
    with conn() as c:
        if not c.execute("SELECT 1 FROM library_items WHERE id=? AND blob IS NOT NULL", (item_id,)).fetchone():
            raise HTTPException(404, "Không tìm thấy file")
        if "folder_id" in b.model_fields_set:
            fid = b.folder_id or None
            if fid and not c.execute("SELECT 1 FROM library_folders WHERE id=?", (fid,)).fetchone():
                raise HTTPException(404, "Thư mục đích không tồn tại")
            c.execute("UPDATE library_items SET folder_id=? WHERE id=?", (fid, item_id))
        for col in ("favorite", "note", "title"):
            v = getattr(b, col)
            if v is not None:
                c.execute(f"UPDATE library_items SET {col}=? WHERE id=?", (int(v) if col == "favorite" else v, item_id))
        if b.add_tag:
            c.execute("INSERT OR IGNORE INTO library_tags(name) VALUES(?)", (b.add_tag,))
            tid = c.execute("SELECT id FROM library_tags WHERE name=?", (b.add_tag,)).fetchone()["id"]
            c.execute("INSERT OR IGNORE INTO library_item_tags VALUES(?,?)", (item_id, tid))
        if b.remove_tag:
            c.execute("DELETE FROM library_item_tags WHERE item_id=? AND tag_id=(SELECT id FROM library_tags WHERE name=?)",
                      (item_id, b.remove_tag))
    return {"ok": True}


@router.delete("/{item_id}")
def delete_item(item_id: int, key: bytes = Depends(guard)):
    with conn() as c:
        r = c.execute("SELECT blob FROM library_items WHERE id=?", (item_id,)).fetchone()
        if not r:
            raise HTTPException(404)
        c.execute("DELETE FROM library_items WHERE id=?", (item_id,))
    if r["blob"]:
        (_blob_dir() / Path(r["blob"]).name).unlink(missing_ok=True)
    return {"ok": True}


@router.get("/item/{item_id}")
def item_info(item_id: int, key: bytes = Depends(guard)):
    with conn() as c:
        r = c.execute("SELECT id,kind,title,ext,size,folder_id FROM library_items WHERE id=? AND blob IS NOT NULL", (item_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Không tìm thấy file")
    return dict(r)


@router.get("/file/{item_id}")
def file(item_id: int, download: bool = False, key: bytes = Depends(guard)):
    with conn() as c:
        r = c.execute("SELECT blob,ext,title,size FROM library_items WHERE id=?", (item_id,)).fetchone()
    if not r or not r["blob"]:
        raise HTTPException(404, "Mục này chưa được mã hóa hoặc không tồn tại")
    vdir = _blob_dir().resolve()
    bp = (vdir / Path(r["blob"]).name).resolve()
    if not bp.is_relative_to(vdir) or not bp.is_file():
        raise HTTPException(404, "Không tìm thấy dữ liệu mã hóa")

    def gen():
        with open(bp, "rb") as f:
            yield from vault.decrypt_iter(key, f)

    ctype = mimetypes.guess_type("x" + (r["ext"] or ""))[0] or "application/octet-stream"
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": ("attachment" if download else "inline") + "; filename*=UTF-8''" + quote((r["title"] or "file") + (r["ext"] or "")),
    }
    if r["size"] is not None:
        headers["Content-Length"] = str(r["size"])
    return StreamingResponse(gen(), media_type=ctype, headers=headers)
