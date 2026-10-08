"""Archive filters must apply across the whole database before pagination."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import db
from routers import core
from services import bot_history


class GameArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch("db.DB_PATH", Path(self.tmp.name) / "app.db")
        self.db_patch.start()
        db.init()
        self.pgn = '[Result "*"]\n\n1. e4 e5 *'
        rows = [("chesscom", "bullet")] * 15 + [("chesscom", " Blitz "),
                ("lichess", "blitz"), ("lichess", "rapid"),
                ("chesscom", "daily"), ("lichess", "classical"),
                ("lichess", "ultrabullet"), ("chesscom", None)]
        with db.conn() as c:
            for i, (platform, speed) in enumerate(rows):
                c.execute("INSERT INTO games(platform,ext_id,played_at,color,opponent,result,time_class,pgn) "
                          "VALUES(?,?,?,?,?,?,?,?)",
                          (platform, str(i), 1700000000 + i, "white", "Opponent", "win", speed, self.pgn))
        bot_history.save(dict(id="bot-1", started_at="2026-10-08T10:00:00Z", opponent="Bot",
                             realm="Luyện Khí", user_color="b", result="*", reason="Đang luận kiếm",
                             pgn=self.pgn, plies=2))
        app = FastAPI()
        app.include_router(core.router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.db_patch.stop()
        self.tmp.cleanup()

    def archive(self, **params):
        response = self.client.get("/api/game-archive", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_legacy_all_sources_and_counts(self):
        data = self.archive()
        self.assertEqual(data["total"], 23)
        self.assertEqual(len(data["items"]), 12)
        self.assertEqual(data["counts"], dict(all=23, bullet=15, blitz=2, rapid=1, other=5))

    def test_speed_filter_before_pagination(self):
        first = self.archive(time_class="bullet")
        second = self.archive(time_class="bullet", page=2)
        self.assertEqual(first["total"], 15)
        self.assertEqual(len(first["items"]), 12)
        self.assertEqual(len(second["items"]), 3)
        self.assertTrue(all(g["time_class"] == "bullet" for g in first["items"] + second["items"]))
        self.assertFalse({g["id"] for g in first["items"]} & {g["id"] for g in second["items"]})

    def test_source_and_speed_with_source_scoped_counts(self):
        data = self.archive(source="chesscom", time_class="blitz")
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["time_class"], "blitz")
        self.assertEqual(data["counts"], dict(all=18, bullet=15, blitz=1, rapid=0, other=2))
        empty = self.archive(source="bot", time_class="rapid")
        self.assertEqual(empty["items"], [])
        self.assertEqual(empty["total"], 0)
        self.assertEqual(empty["counts"]["other"], 1)

    def test_unknown_speeds_and_bot_remain_accessible(self):
        data = self.archive(time_class="other")
        self.assertEqual(data["total"], 5)
        self.assertEqual({g["source"] for g in data["items"]}, {"bot", "chesscom", "lichess"})
        for game in data["items"]:
            detail = self.client.get(f'/api/game-archive/{game["source"]}/{game["id"]}')
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["pgn"], self.pgn)

    def test_empty_database(self):
        with db.conn() as c:
            c.execute("DELETE FROM games")
            c.execute("DELETE FROM bot_games")
        data = self.archive(time_class="rapid")
        self.assertEqual(data["items"], [])
        self.assertEqual(data["counts"], dict(all=0, bullet=0, blitz=0, rapid=0, other=0))

    def test_invalid_filters_and_pagination(self):
        for params in ({"time_class": "bogus"}, {"source": "bogus"}, {"page": 0}, {"size": 51}):
            self.assertEqual(self.client.get("/api/game-archive", params=params).status_code, 422)


if __name__ == "__main__":
    unittest.main()
