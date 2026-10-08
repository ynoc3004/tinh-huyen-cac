"""Profile persistence, validation and migration on an existing app database."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import db
from routers import core


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch("db.DB_PATH", Path(self.tmp.name) / "app.db")
        self.db_patch.start()
        db.init()
        app = FastAPI()
        app.include_router(core.router)
        self.client = TestClient(app)
        self.profile = dict(full_name=" Nguyễn Văn An ", dao_name="Tĩnh Tâm", birth_date="2000-02-29",
                            birth_time="23:45", hometown="Thủ Đức", goal="Đạt rapid 1500",
                            notes="Vững căn cơ.\nÔn tàn cuộc mỗi ngày.")

    def tearDown(self):
        self.client.close()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_initial_profile_is_blank_without_creating_a_row(self):
        r = self.client.get("/api/profile")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["full_name"], "")
        self.assertIsNone(r.json()["birth_date"])
        self.assertIsNone(r.json()["updated_at"])
        with db.conn() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM cultivation_profile").fetchone()[0], 0)

    def test_save_persists_across_connections_and_app_restart(self):
        response = self.client.put("/api/profile", json=self.profile)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["full_name"], "Nguyễn Văn An")
        self.assertEqual(data["notes"], self.profile["notes"])
        self.assertEqual(data["birth_date"], "2000-02-29")
        self.assertTrue(data["updated_at"])
        db.init()
        app = FastAPI()
        app.include_router(core.router)
        with TestClient(app) as new_client:
            self.assertEqual(new_client.get("/api/profile").json(), data)

    def test_edit_and_clear_optional_fields_update_one_record(self):
        self.client.put("/api/profile", json=self.profile)
        updated = dict(self.profile, dao_name="Huyền An", birth_date=None, birth_time=None, notes="")
        self.assertEqual(self.client.put("/api/profile", json=updated).status_code, 200)
        data = self.client.get("/api/profile").json()
        self.assertEqual(data["dao_name"], "Huyền An")
        self.assertIsNone(data["birth_date"])
        self.assertIsNone(data["birth_time"])
        self.assertEqual(data["notes"], "")
        with db.conn() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM cultivation_profile").fetchone()[0], 1)

    def test_bad_date_time_and_oversized_inputs_do_not_overwrite(self):
        self.client.put("/api/profile", json=self.profile)
        before = self.client.get("/api/profile").json()
        for change in ({"birth_date": "2001-02-29"}, {"birth_time": "24:00"}, {"birth_time": "7:5"},
                       {"full_name": "x" * 121}, {"notes": "x" * 5001}, {"full_name": None}):
            self.assertEqual(self.client.put("/api/profile", json={**self.profile, **change}).status_code, 422)
            self.assertEqual(self.client.get("/api/profile").json(), before)

    def test_migration_preserves_existing_chess_data(self):
        with db.conn() as c:
            c.execute("DROP TABLE cultivation_profile")
            c.execute("INSERT INTO rating_history(platform,time_class,day,rating) VALUES('lichess','rapid','2026-10-08',1500)")
            c.execute("INSERT INTO games(platform,ext_id,pgn) VALUES('lichess','old','1. e4 *')")
        db.init()
        self.assertEqual(self.client.put("/api/profile", json=self.profile).status_code, 200)
        self.assertEqual(self.client.get("/api/realm").json()["tu_vi"]["rating"], 1500)
        with db.conn() as c:
            self.assertEqual(c.execute("SELECT pgn FROM games WHERE ext_id='old'").fetchone()[0], "1. e4 *")

    def test_text_is_stored_as_data(self):
        data = dict(self.profile, dao_name="O'Brien <script>alert(1)</script>")
        self.assertEqual(self.client.put("/api/profile", json=data).status_code, 200)
        self.assertEqual(self.client.get("/api/profile").json()["dao_name"], data["dao_name"])


if __name__ == "__main__":
    unittest.main()
