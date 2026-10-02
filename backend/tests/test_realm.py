"""Tu vi lấy ELO ván cờ thấp nhất làm căn cơ."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.realm import realm, summary


class RealmSummaryTests(unittest.TestCase):
    def test_lowest_game_rating_is_tu_vi(self):
        rows = [
            {"platform": "chesscom", "time_class": "daily", "rating": 2000},
            {"platform": "lichess", "time_class": "blitz", "rating": 1608},
            {"platform": "lichess", "time_class": "puzzle", "rating": 1608},
            {"platform": "chesscom", "time_class": "rapid", "rating": 1501},
            {"platform": "lichess", "time_class": "rapid", "rating": 1303},
            {"platform": "chesscom", "time_class": "blitz", "rating": 1153},
            {"platform": "chesscom", "time_class": "bullet", "rating": 1039},
            {"platform": "lichess", "time_class": "bullet", "rating": 792},
        ]
        s = summary(rows)
        self.assertEqual(s["tu_vi"]["rating"], 792)
        self.assertEqual(s["tu_vi"]["realm"], "Phàm Nhân")
        self.assertEqual(s["tu_vi"]["tier"], 9)
        self.assertEqual(s["tu_vi"]["platform"], "lichess")
        self.assertEqual(s["tu_vi"]["time_class"], "bullet")
        self.assertTrue(s["tu_vi"]["is_can_co"])
        daily = next(x for x in s["mach"] if x["time_class"] == "daily")
        puzzle = next(x for x in s["mach"] if x["time_class"] == "puzzle")
        self.assertFalse(daily["is_can_co"])
        self.assertFalse(puzzle["is_can_co"])
        self.assertEqual(s["mach"][0]["rating"], 792)

    def test_puzzle_does_not_set_tu_vi_when_games_exist(self):
        rows = [
            {"platform": "lichess", "time_class": "puzzle", "rating": 100},
            {"platform": "lichess", "time_class": "blitz", "rating": 1608},
        ]
        s = summary(rows)
        self.assertEqual(s["tu_vi"]["time_class"], "blitz")
        self.assertEqual(s["tu_vi"]["rating"], 1608)

    def test_puzzle_only_falls_back(self):
        s = summary([{"platform": "lichess", "time_class": "puzzle", "rating": 1608}])
        self.assertEqual(s["tu_vi"]["rating"], 1608)
        self.assertTrue(s["tu_vi"]["is_can_co"])

    def test_empty(self):
        s = summary([])
        self.assertIsNone(s["tu_vi"])
        self.assertEqual(s["mach"], [])

    def test_hoa_than_bounds(self):
        r = realm(2000)
        self.assertEqual(r["realm"], "Hóa Thần")
        self.assertEqual(r["tier"], 1)


if __name__ == "__main__":
    unittest.main()
