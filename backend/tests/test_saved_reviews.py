"""Durable engine snapshots, migration-safe init and vault isolation."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import db
from routers import library, reviews


class SavedReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch("db.DB_PATH", Path(self.tmp.name) / "test.db")
        self.lib_patch = patch.object(library, "LIBRARY_DIR", Path(self.tmp.name) / "vault")
        self.db_patch.start(); self.lib_patch.start()
        library.LIBRARY_DIR.mkdir()
        library.reset_state(); db.init()
        app = FastAPI(); app.include_router(library.router); app.include_router(reviews.router)
        self.client = TestClient(app)
        self.key = "a" * 64
        score = dict(cp=25, mate=None, mateWinner=None, pv=["e2e4"], depth=16, limited=False)
        self.data = dict(version=2, engine="stockfish-19-lite", quality=750,
                         pgn='[White "Thanh"]\n[Black "Opponent"]\n\n1. e4 e5 *',
                         white="Thanh", black="Opponent", event="Club", result="*", plies=2,
                         scores=[{**score, "lines": [score]} for _ in range(3)],
                         playedScores=[score.copy(), score.copy()], flip=False)

    def tearDown(self):
        self.client.close(); library.reset_state()
        self.lib_patch.stop(); self.db_patch.stop(); self.tmp.cleanup()

    def store_public(self, data=None):
        response = self.client.put(f"/api/reviews/{self.key}", json=data or self.data)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def import_pgn(self):
        response = self.client.post("/api/library/vault/setup", json={"password": "mat-khau-1"})
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.post("/api/library/import?name=test.pgn", content=self.data["pgn"].encode())
        self.assertEqual(response.status_code, 200, response.text)
        return self.client.get("/api/library").json()[0]["id"]

    def test_public_round_trip_and_restart_without_reanalysis(self):
        self.store_public()
        db.init()  # Opening an existing installation leaves results intact.
        other = TestClient(self.client.app)
        response = other.get(f"/api/reviews/{self.key}")
        self.assertEqual(response.status_code, 200)
        restored = response.json()
        for field in ("pgn", "quality", "scores", "playedScores", "flip"):
            self.assertEqual(restored[field], self.data[field])
        self.assertEqual(response.headers["cache-control"], "no-store")
        listing = other.get("/api/reviews").json()["items"]
        self.assertEqual(len(listing), 1); self.assertTrue(listing[0]["complete"])
        self.assertNotIn("pgn", listing[0]); self.assertNotIn("scores", listing[0])
        other.close()

    def test_upsert_and_partial_progress(self):
        self.store_public()
        partial = {**self.data, "scores": self.data["scores"][:1], "playedScores": self.data["playedScores"][:1]}
        self.store_public(partial)
        listing = self.client.get("/api/reviews").json()["items"]
        self.assertEqual(len(listing), 1); self.assertFalse(listing[0]["complete"])
        self.assertEqual(listing[0]["analyzed"], 1)

    def test_invalid_payload_is_not_saved(self):
        for mutate in (lambda d: d.update(version=1), lambda d: d.update(pgn=""),
                       lambda d: d.update(plies=0), lambda d: d.update(scores=[]),
                       lambda d: d["scores"][0].update(cp=None),
                       lambda d: d["playedScores"][0].update(pv=["illegal"]),
                       lambda d: d.update(white=["Name"])):
            data = copy.deepcopy(self.data); mutate(data)
            self.assertEqual(self.client.put(f"/api/reviews/{self.key}", json=data).status_code, 422)
        self.assertEqual(self.client.put("/api/reviews/bad", json=self.data).status_code, 422)
        self.assertEqual(self.client.put(f"/api/reviews/{self.key}", content=b"not-json").status_code, 422)
        self.assertEqual(self.client.get("/api/reviews").json()["items"], [])

    def test_nonfinite_and_oversized_requests(self):
        import json
        data = copy.deepcopy(self.data); data["scores"][0]["cp"] = float("nan")
        self.assertEqual(self.client.put(f"/api/reviews/{self.key}", content=json.dumps(data)).status_code, 422)
        with patch.object(reviews, "MAX_BODY", 10):
            self.assertEqual(self.client.put(f"/api/reviews/{self.key}", json=self.data).status_code, 413)

    def test_missing_results_do_not_create_records(self):
        self.assertEqual(self.client.get(f"/api/reviews/{self.key}").status_code, 404)
        self.assertEqual(self.client.get("/api/reviews/bad").status_code, 422)

    def test_protected_storage_is_encrypted_and_isolated(self):
        item = self.import_pgn(); url = f"/api/library/reviews/{item}/{self.key}"
        self.assertEqual(self.client.put(url, json=self.data).status_code, 200)
        with db.conn() as c:
            row = c.execute("SELECT metadata,payload FROM saved_reviews").fetchone()
        for column in ("metadata", "payload"):
            self.assertTrue(row[column].startswith(b"THC1")); self.assertNotIn(b"Thanh", row[column])
        self.assertEqual(self.client.get("/api/reviews").json()["items"], [])
        self.assertEqual(self.client.get(f"/api/reviews/{self.key}").status_code, 404)
        listing = self.client.get("/api/library/reviews").json()["items"]
        self.assertEqual(listing[0]["item_id"], item)
        self.assertEqual(self.client.get(url).json()["pgn"], self.data["pgn"])
        self.client.post("/api/library/vault/lock")
        self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.get("/api/library/reviews").status_code, 401)
        self.assertEqual(self.client.put(url, json=self.data).status_code, 401)
        self.assertEqual(self.client.post("/api/library/vault/unlock", json={"password": "mat-khau-1"}).status_code, 200)
        self.assertEqual(self.client.get(url).json()["scores"], self.data["scores"])

    def test_deleted_pgn_removes_saved_result(self):
        item = self.import_pgn(); url = f"/api/library/reviews/{item}/{self.key}"
        self.assertEqual(self.client.put(url, json=self.data).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/library/{item}").status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get("/api/library/reviews").json()["items"], [])
        with db.conn() as c:
            self.assertEqual(c.execute("SELECT COUNT(*) FROM saved_reviews").fetchone()[0], 0)

    def test_protected_snapshot_must_match_original(self):
        item = self.import_pgn(); url = f"/api/library/reviews/{item}/{self.key}"
        self.assertEqual(self.client.put(url, json={**self.data, "pgn": "1. d4 d5 *"}).status_code, 409)
        self.assertEqual(self.client.put(f"/api/library/reviews/999/{self.key}", json=self.data).status_code, 404)


if __name__ == "__main__":
    unittest.main()
