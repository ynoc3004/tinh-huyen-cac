import os
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PUZZLE_DB = DATA / "puzzles.db"  # kho câu đố Lichess đã lọc (tạo bằng import_puzzles.py)


def _load_env():
    """Đọc file .env (KEY=VALUE) ở backend/ hoặc thư mục gốc; biến môi trường thật được ưu tiên."""
    for d in (Path(__file__).resolve().parent, ROOT):
        f = d / ".env"
        if not f.is_file():
            continue
        for line in f.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()
DB_PATH = DATA / "app.db"
LIBRARY_DIR = Path(os.getenv("LIBRARY_DIR", DATA / "library"))  # có thể trỏ tới thư mục PNG sẵn có
CHESSCOM_USER = os.getenv("CHESSCOM_USER", "")
LICHESS_USER = os.getenv("LICHESS_USER", "")
MASTER_URL = os.getenv("MASTER_URL", "")  # chatbot sư phụ, gắn sau
UA = {"User-Agent": "tinh-huyen-cac/0.1 (personal use)"}
DATA.mkdir(exist_ok=True); LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")  # mật khẩu xóa giải


def _float(name, default):
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return float(default)


# Nơi bạn ở, dùng cho giờ mặt trời mọc/lặn và thời tiết trên trang chủ (mặc định: TP. Hồ Chí Minh)
HOME_NAME = os.getenv("HOME_NAME", "TP. Hồ Chí Minh")
HOME_LAT = _float("HOME_LAT", "10.7769")
HOME_LON = _float("HOME_LON", "106.7009")
