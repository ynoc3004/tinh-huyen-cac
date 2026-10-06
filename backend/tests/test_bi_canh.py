"""Kiểm tra Bí cảnh: chọn câu theo cảnh giới, nạp kho CSV, nhật ký và API. Không dùng mạng."""
import csv
import random
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
import db
TEMP = tempfile.TemporaryDirectory()
db.DB_PATH = Path(TEMP.name) / "test.db"
from fastapi.testclient import TestClient
from main import app
from services import puzzles

FEN = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"
HEAD = ["PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity", "NbPlays", "Themes", "GameUrl", "OpeningTags"]


def make_csv(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEAD)
        for r in rows:
            w.writerow(r)


class TargetTests(unittest.TestCase):
    def test_target_follows_realm_and_tier(self):
        rng = random.Random(1)
        for realm, (lo, hi) in puzzles.REALM_BANDS.items():
            vals = [puzzles.target_rating(realm, 5, 0, rng) for _ in range(200)]
            self.assertTrue(all(lo - 150 <= v <= hi + 150 for v in vals), realm)
        avg = lambda realm, tier: sum(puzzles.target_rating(realm, tier, 0, random.Random(i)) for i in range(300)) / 300
        self.assertLess(avg("Trúc Cơ", 1), avg("Trúc Cơ", 9))
        self.assertLess(avg("Luyện Khí", 5), avg("Kim Đan", 5))

    def test_bias_and_clamps(self):
        a = sum(puzzles.target_rating("Luyện Khí", 3, 0, random.Random(i)) for i in range(300)) / 300
        b = sum(puzzles.target_rating("Luyện Khí", 3, 200, random.Random(i)) for i in range(300)) / 300
        self.assertGreater(b, a + 120)
        self.assertEqual(puzzles.target_rating("Không có", 1, 9999, random.Random(3)) <= puzzles.DEFAULT_BAND[1] + 150, True)


class ImportAndPickTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        config.PUZZLE_DB = Path(self.tmp.name) / "p.db"
        self.csv = Path(self.tmp.name) / "p.csv"
        rows = []
        for i in range(300):
            rating = 500 + i * 8                       # 500..2892
            themes = "mate mateIn1" if i % 2 else "fork middlegame"
            rows.append([f"P{i:04d}", FEN, "g8h8 a1a8", rating, 80, 95, 5000, themes, "https://lichess.org/x", ""])
        rows.append(["LOWPOP", FEN, "g8h8 a1a8", 1000, 80, 10, 5000, "mate", "", ""])    # độ phổ biến thấp: phải bị loại
        rows.append(["FEWPLAYS", FEN, "g8h8 a1a8", 1000, 80, 95, 3, "mate", "", ""])    # ít người chơi: bị loại
        rows.append(["HARD", FEN, "g8h8 a1a8", 2400, 80, 70, 100, "mate", "", ""])      # câu rất khó: ngưỡng được nới
        make_csv(self.csv, rows)

    def tearDown(self):
        config.PUZZLE_DB = config.DATA / "puzzles.db"
        self.tmp.cleanup()

    def test_import_filters_and_caps(self):
        import sqlite3
        r = puzzles.import_csv(self.csv)
        ids = {x[0] for x in sqlite3.connect(config.PUZZLE_DB).execute("SELECT id FROM puzzles")}
        self.assertNotIn("LOWPOP", ids)
        self.assertNotIn("FEWPLAYS", ids)
        self.assertIn("HARD", ids)
        self.assertEqual(r["kept"], len(ids))
        r = puzzles.import_csv(self.csv, per_bucket=3)
        c = sqlite3.connect(config.PUZZLE_DB)
        ids = {x[0] for x in c.execute("SELECT id FROM puzzles")}
        per = {}
        for (rt,) in c.execute("SELECT rating FROM puzzles"):
            per[rt // 50] = per.get(rt // 50, 0) + 1
        self.assertLessEqual(max(per.values()), 3)
        self.assertEqual(r["kept"], len(ids))

    def test_import_reads_zst(self):
        try:
            import zstandard
        except ImportError:
            self.skipTest("chưa cài zstandard")
        z = Path(self.tmp.name) / "p.csv.zst"
        z.write_bytes(zstandard.ZstdCompressor().compress(self.csv.read_bytes()))
        r = puzzles.import_csv(z)
        self.assertGreater(r["kept"], 250)

    def test_import_rejects_garbage(self):
        bad = Path(self.tmp.name) / "bad.csv"
        bad.write_text("a,b\n1,2\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            puzzles.import_csv(bad)

    def test_pick_stays_near_realm_and_filters_theme_and_exclude(self):
        puzzles.import_csv(self.csv, per_bucket=50)
        rng = random.Random(5)
        for realm, (lo, hi) in (("Phàm Nhân", puzzles.REALM_BANDS["Phàm Nhân"]), ("Kim Đan", puzzles.REALM_BANDS["Kim Đan"])):
            for _ in range(30):
                p = puzzles.pick(realm, 5, 0, rng=rng)
                self.assertEqual(p["source"], "lichess")
                self.assertTrue(lo - 400 <= p["rating"] <= hi + 400, (realm, p["rating"]))
        t = puzzles.pick("Luyện Khí", 3, 0, theme="fork", rng=rng)
        self.assertIn("fork", t["themes"])
        seen = set()
        for _ in range(40):
            p = puzzles.pick("Luyện Khí", 3, 0, exclude=seen, rng=rng)
            self.assertNotIn(p["id"], seen)
            seen.add(p["id"])
        st = puzzles.status()
        self.assertFalse(st["sample"])
        self.assertGreater(st["themes"]["mate"], 0)

    def test_unknown_theme_falls_back(self):
        puzzles.import_csv(self.csv)
        p = puzzles.pick("Luyện Khí", 3, 0, theme="khongcothat", rng=random.Random(1))
        self.assertIsNotNone(p)


class SampleAndApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        config.PUZZLE_DB = Path(self.tmp.name) / "none.db"   # chưa có kho: dùng bộ mẫu
        self.client = TestClient(app)
        db.init()
        with db.conn() as c:
            c.execute("DELETE FROM puzzle_log")

    def tearDown(self):
        config.PUZZLE_DB = config.DATA / "puzzles.db"
        self.tmp.cleanup()

    def test_sample_set_is_valid_and_playable(self):
        import chess
        data = puzzles._sample()
        self.assertGreaterEqual(len(data), 20)
        for p in data:
            b = chess.Board(p["fen"])
            for u in p["moves"]:
                m = chess.Move.from_uci(u)
                self.assertIn(m, b.legal_moves, p["id"])
                b.push(m)
            self.assertTrue(b.is_checkmate(), p["id"])

    def test_api_sample_by_realm(self):
        j = self.client.get("/api/bi-canh/status").json()
        self.assertTrue(j["sample"])
        lo = self.client.get("/api/bi-canh/puzzle", params={"realm": "Phàm Nhân", "tier": 1}).json()
        hi = self.client.get("/api/bi-canh/puzzle", params={"realm": "Hóa Thần", "tier": 9}).json()
        self.assertEqual(lo["source"], "mau")
        self.assertLess(lo["rating"], hi["rating"])
        self.assertEqual(lo["band"], list(puzzles.REALM_BANDS["Phàm Nhân"]))
        self.assertEqual(self.client.get("/api/bi-canh/puzzle", params={"tier": 99}).status_code, 422)
        self.assertEqual(self.client.get("/api/bi-canh/puzzle", params={"theme": "a;b"}).status_code, 422)

    def test_result_stats_and_no_repeat(self):
        body = {"puzzle_id": "S001", "rating": 500, "realm": "Phàm Nhân", "solved": True, "mistakes": 1, "hints": 0, "seconds": 12.5}
        s = self.client.post("/api/bi-canh/result", json=body).json()
        self.assertEqual((s["today"], s["total"], s["streak"]), (1, 1, 1))
        self.client.post("/api/bi-canh/result", json={**body, "puzzle_id": "S002", "solved": False})
        s = self.client.get("/api/bi-canh/stats").json()
        self.assertEqual((s["today"], s["total"]), (1, 1))
        self.assertEqual(s["recent"], [True, False])
        bad = self.client.post("/api/bi-canh/result", json={**body, "rating": -5})
        self.assertEqual(bad.status_code, 422)
        seen = set()
        for _ in range(8):
            p = self.client.get("/api/bi-canh/puzzle", params={"realm": "Phàm Nhân", "tier": 1}).json()
            self.assertNotIn(p["id"], ("S001", "S002"))
            self.client.post("/api/bi-canh/result", json={**body, "puzzle_id": p["id"]})

    def test_streak_counts_consecutive_days(self):
        with db.conn() as c:
            for d in (0, 1, 2, 4):
                c.execute("INSERT INTO puzzle_log(puzzle_id, rating, realm, solved, at) VALUES('x',500,'a',1, datetime('now', ?))", (f"-{d} days",))
        self.assertEqual(puzzles.stats()["streak"], 3)


if __name__ == "__main__":
    unittest.main()
