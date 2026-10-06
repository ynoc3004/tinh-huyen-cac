"""Nạp kho câu đố Lichess cho trang Bí cảnh.

Cách dùng (chạy trong thư mục backend):
  python import_puzzles.py --file D:\\duong-dan\\lichess_db_puzzle.csv      # dùng file đã tải (.csv hoặc .csv.zst)
  python import_puzzles.py --download                                        # tự tải từ database.lichess.org (khoảng 250 MB)
Kết quả là data/puzzles.db với khoảng 50 nghìn câu đã lọc, đủ mọi cảnh giới.
"""
import argparse
import sys
from pathlib import Path

import config
from services import puzzles


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="đường dẫn lichess_db_puzzle.csv hoặc .csv.zst")
    ap.add_argument("--download", action="store_true", help="tải kho từ Lichess rồi nạp")
    ap.add_argument("--per-bucket", type=int, default=1500, help="số câu tối đa mỗi khoảng 50 điểm (mặc định 1500)")
    a = ap.parse_args()
    path = a.file
    if a.download:
        dest = config.DATA / "lichess_db_puzzle.csv.zst"
        print("Đang tải", puzzles.URL)
        puzzles.download(dest, lambda d, t: print(f"\r  {d >> 20} MB" + (f" / {t >> 20} MB" if t else ""), end="", flush=True))
        print()
        path = str(dest)
    if not path:
        for guess in (config.DATA / "lichess_db_puzzle.csv", config.DATA / "lichess_db_puzzle.csv.zst", Path("lichess_db_puzzle.csv")):
            if guess.is_file():
                path = str(guess)
                break
    if not path or not Path(path).is_file():
        sys.exit("Không thấy file câu đố. Dùng --file <đường dẫn> hoặc --download. Xem: python import_puzzles.py --help")
    print("Đang lọc", path, "(vài phút với file đầy đủ)")
    r = puzzles.import_csv(path, per_bucket=a.per_bucket, progress=lambda n: print(f"\r  đã đọc {n:,} dòng", end="", flush=True))
    print(f"\nXong: đọc {r['rows_read']:,} dòng, giữ {r['kept']:,} câu ở {r['buckets']} khoảng điểm.\nLưu tại {config.PUZZLE_DB}")


if __name__ == "__main__":
    main()
