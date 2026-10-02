"""Mã hóa cho Tàng Kinh Các.

- Mật khẩu -> scrypt -> khóa bọc (KEK). KEK bọc một khóa dữ liệu ngẫu nhiên (DK) bằng AES-256-GCM.
  Đổi mật khẩu chỉ cần bọc lại DK, không phải mã hóa lại từng file.
- File được mã hóa theo từng khối 1 MiB bằng AES-256-GCM. Mỗi khối có nonce riêng (tiền tố ngẫu nhiên
  + bộ đếm) và cờ "khối cuối" nằm trong AAD, nên không thể cắt bớt, đảo thứ tự hay sửa nội dung mà không bị phát hiện.
"""
import base64
import hashlib
import hmac
import json
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"THC1"
CHUNK = 1 << 20
TAG = 16
KDF = {"n": 2 ** 15, "r": 8, "p": 1}
MIN_PASSWORD = 8


class WrongPassword(ValueError):
    pass


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _unb64(s: str) -> bytes:
    return base64.b64decode(s.encode("ascii"))


def _kek(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return Scrypt(salt=salt, length=32, n=n, r=r, p=p).derive(password.encode("utf-8"))


def _wrap(kek: bytes, data_key: bytes) -> str:
    nonce = os.urandom(12)
    return _b64(nonce + AESGCM(kek).encrypt(nonce, data_key, b"THC-DK"))


def create_meta(password: str):
    """Tạo thông tin két mới. Trả về (meta, data_key)."""
    salt = os.urandom(16)
    data_key = os.urandom(32)
    kek = _kek(password, salt, KDF["n"], KDF["r"], KDF["p"])
    meta = {"v": 1, "kdf": "scrypt", **KDF, "salt": _b64(salt), "wrapped": _wrap(kek, data_key)}
    return meta, data_key


def unlock_meta(meta: dict, password: str) -> bytes:
    try:
        kek = _kek(password, _unb64(meta["salt"]), meta["n"], meta["r"], meta["p"])
        raw = _unb64(meta["wrapped"])
        return AESGCM(kek).decrypt(raw[:12], raw[12:], b"THC-DK")
    except InvalidTag:
        raise WrongPassword("Sai mật khẩu")


def rewrap_meta(meta: dict, data_key: bytes, new_password: str) -> dict:
    salt = os.urandom(16)
    kek = _kek(new_password, salt, KDF["n"], KDF["r"], KDF["p"])
    return {"v": 1, "kdf": "scrypt", **KDF, "salt": _b64(salt), "wrapped": _wrap(kek, data_key)}


def read_meta(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_meta(path, meta: dict):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(meta), encoding="utf-8")
    os.replace(tmp, path)


def new_hmac(data_key: bytes):
    """Dấu vân tay nội dung (HMAC) để phát hiện file trùng mà không lộ SHA-1 của file."""
    return hmac.new(data_key, digestmod=hashlib.sha256)


def _nonce(prefix: bytes, i: int) -> bytes:
    return prefix + i.to_bytes(4, "big")


class Encryptor:
    def __init__(self, key: bytes, out):
        self._aes = AESGCM(key)
        self._prefix = os.urandom(8)
        self._out = out
        self._i = 0
        self._buf = bytearray()
        out.write(MAGIC + self._prefix)

    def _emit(self, data: bytes, final: bool):
        self._out.write(self._aes.encrypt(_nonce(self._prefix, self._i), data, b"\x01" if final else b"\x00"))
        self._i += 1

    def write(self, data: bytes):
        self._buf += data
        while len(self._buf) > CHUNK:  # giữ lại ít nhất 1 byte cho khối cuối
            piece = bytes(self._buf[:CHUNK])
            del self._buf[:CHUNK]
            self._emit(piece, False)

    def finish(self):
        self._emit(bytes(self._buf), True)
        self._buf = bytearray()


def decrypt_iter(key: bytes, f):
    head = f.read(len(MAGIC) + 8)
    if len(head) != len(MAGIC) + 8 or head[: len(MAGIC)] != MAGIC:
        raise ValueError("File không đúng định dạng két")
    prefix = head[len(MAGIC):]
    aes = AESGCM(key)
    cur = f.read(CHUNK + TAG)
    if not cur:
        raise ValueError("File mã hóa bị cắt cụt")
    i = 0
    while True:
        nxt = f.read(CHUNK + TAG) if len(cur) == CHUNK + TAG else b""
        final = not nxt
        try:
            plain = aes.decrypt(_nonce(prefix, i), cur, b"\x01" if final else b"\x00")
        except InvalidTag:
            raise ValueError("Dữ liệu bị hỏng hoặc đã bị sửa")
        yield plain
        if final:
            return
        cur = nxt
        i += 1
