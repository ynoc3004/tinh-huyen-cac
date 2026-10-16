import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
import pymupdf
from fastapi import FastAPI
from fastapi.testclient import TestClient
import db
from routers import library, translation
from services import vault

class LocalOllama:
    calls = 0
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    def __init__(self, *args, **kwargs): pass
    async def get(self, url):
        return httpx.Response(200, json={"models": [{"name": "qwen3:4b"}, {"name": "remote-cloud", "remote_host": "example"}]}, request=httpx.Request("GET", url))
    async def post(self, url, json):
        LocalOllama.calls += 1
        return httpx.Response(200, json={"response": json["prompt"].replace("White plays", "Trắng đi").replace(" plays ", " đi "), "done_reason": "stop"}, request=httpx.Request("POST", url))

class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.patches = [patch.object(db, "DB_PATH", root / "test.db"),
                        patch.object(library, "LIBRARY_DIR", root / "books"),
                        patch.object(library, "LINK_FILE", root / "link.json")]
        for p in self.patches: p.start()
        library.reset_state(); db.init()
        app = FastAPI(); app.include_router(library.router); app.include_router(translation.router)
        self.client = TestClient(app)
        self.client.post("/api/library/vault/setup", json={"password": "testing123"})
        with pymupdf.open() as doc:
            doc.new_page().insert_text((50, 50), "White plays Nf3 and O-O.")
            doc.new_page().insert_text((50, 50), "Second page.")
            raw = doc.tobytes()
        self.client.post("/api/library/import?name=book.pdf", content=raw)
        self.item = self.client.get("/api/library").json()[0]["id"]
        self.base = f"/api/library/translation/{self.item}"
    def tearDown(self):
        self.client.close(); library.reset_state()
        for p in reversed(self.patches): p.stop()
        self.tmp.cleanup()
    def test_pdf_page_state_and_lock(self):
        page = self.client.get(self.base + "/page?page=1").json()
        self.assertEqual(page["pages"], 2); self.assertIn("Nf3", page["text"])
        self.assertEqual(self.client.get(self.base + "/page?page=3").status_code, 400)
        self.client.put(self.base + "/state", json={"page": 2, "bookmark": 1, "note": "Ghi chú"})
        self.assertEqual(self.client.get(self.base + "/state").json()["page"], 2)
        self.client.post("/api/library/vault/lock")
        self.assertEqual(self.client.get(self.base + "/state").status_code, 401)
        self.assertEqual(self.client.get(self.base + "/page").status_code, 401)
    def test_translation_encrypted_cache_and_models(self):
        LocalOllama.calls = 0
        body = {"text": "White plays Nf3 and O-O.", "model": "qwen3:4b", "page": 1}
        with patch.object(translation.httpx, "AsyncClient", LocalOllama):
            models = self.client.get("/api/library/translation/models").json()
            self.assertIn("qwen3:4b", models["models"]); self.assertNotIn("remote-cloud", models["models"])
            r = self.client.post(self.base + "/translate", json=body)
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.json()["translation"], "Trắng đi Nf3 and O-O.")
            self.assertTrue(self.client.post(self.base + "/translate", json=body).json()["cached"])
            self.assertEqual(LocalOllama.calls, 1)
            self.assertEqual(self.client.post(self.base + "/cached", json=body).json()["translation"], r.json()["translation"])
            self.assertEqual(self.client.post(self.base + "/translate", json={**body,"model":"remote-cloud"}).status_code, 400)
        files = list((library._blob_dir() / "translations").glob("*.thc"))
        self.assertTrue(files)
        self.assertNotIn(b"White plays", files[0].read_bytes())
        self.assertNotIn("Trắng đi".encode(), files[0].read_bytes())
    def test_ollama_page_checkpoints_resume_and_do_not_replace_book_job(self):
        source = "White plays Nf3 and O-O. " + " ".join(
            f"The bishop has an active role in variation number {n}." for n in range(18))
        body = {"text": source, "model": "qwen3:4b", "page": 1, "glossary": "bishop=quân tượng"}
        job = self.client.post(self.base + "/batch/start", json={"model": "qwen3:4b", "start": 1, "end": 2}).json()
        plan = self.client.post(self.base + "/translate/plan", json=body)
        self.assertEqual(plan.status_code, 200, plan.text)
        chunks = plan.json()["chunks"]
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 600 for chunk in chunks))
        self.assertEqual(" ".join(" ".join(chunks).split()), " ".join(source.split()))
        LocalOllama.calls = 0
        with patch.object(translation.httpx, "AsyncClient", LocalOllama):
            first = {**body, "text": chunks[0]}
            self.assertEqual(self.client.post(self.base + "/translate", json=first).status_code, 200)
            self.assertEqual(self.client.post(self.base + "/translate/complete", json=body).status_code, 409)
            self.assertIsNone(self.client.post(self.base + "/cached", json=body).json()["translation"])
            class TimedOut(LocalOllama):
                async def post(self, url, json):
                    raise httpx.ReadTimeout("test timeout")
            with patch.object(translation.httpx, "AsyncClient", TimedOut):
                failed = self.client.post(self.base + "/translate", json={**body, "text": chunks[1]})
                self.assertEqual(failed.status_code, 504, failed.text)
            self.assertTrue(self.client.post(self.base + "/translate", json=first).json()["cached"])
            self.assertEqual(LocalOllama.calls, 1)
            for chunk in chunks[1:]:
                result = self.client.post(self.base + "/translate", json={**body, "text": chunk})
                self.assertEqual(result.status_code, 200, result.text)
            # Cache identity includes model and user terminology.
            for change in ({"model": "qwen3:1.7b"}, {"glossary": "bishop=tượng"}, {"page": 2}):
                self.assertEqual(self.client.post(self.base + "/translate/complete", json={**body, **change}).status_code, 409)
            result = self.client.post(self.base + "/translate/complete", json=body)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertIn("Trắng đi Nf3 and O-O.", result.json()["translation"])
            self.assertEqual(self.client.post(self.base + "/cached", json=body).json()["translation"], result.json()["translation"])
        self.assertEqual(self.client.get(self.base + "/batch").json()["signature"], job["signature"])
        self.assertEqual(self.client.get(self.base + "/batch").json()["done"], 0)
        self.client.post("/api/library/vault/lock")
        for endpoint in ("plan", "complete"):
            self.assertEqual(self.client.post(self.base + "/translate/" + endpoint, json=body).status_code, 401)

    def test_ollama_short_prompt_and_notation_only_skip_generation(self):
        calls = []
        class Capture(LocalOllama):
            async def post(self, url, json):
                calls.append(json)
                return await super().post(url, json)
        body = {"text": "White plays Nf3 with the bishop.", "model": "qwen3:4b", "page": 1}
        with patch.object(translation.httpx, "AsyncClient", Capture):
            self.assertEqual(self.client.post(self.base + "/translate", json=body).status_code, 200)
            self.assertIn("bishop=tượng", calls[0]["system"])
            self.assertNotIn("endgame=tàn cuộc", calls[0]["system"])
            self.assertFalse(calls[0]["think"])
            self.assertEqual(calls[0]["options"]["num_ctx"], 4096)
            self.assertLessEqual(calls[0]["options"]["num_predict"], 2048)
            moves = {**body, "text": "1. Nf3 d5 2. O-O Bxh7+"}
            result = self.client.post(self.base + "/translate", json=moves)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["translation"], moves["text"])
            self.assertEqual(len(calls), 1)
        for model in ("opus-mt-en-vi", "deepl:en-vi", "gemini:test"):
            self.assertEqual(self.client.post(self.base + "/translate/plan", json={**body, "model": model}).status_code, 400)

    def test_notation_tokens(self):
        original = "1. Nf3 d5 2. O-O Bxh7+ e8=Q#"
        text, tokens = translation.protect_moves(original)
        self.assertEqual(translation.restore_moves(text, tokens), original)
        with self.assertRaises(ValueError): translation.restore_moves("", tokens)

if __name__ == "__main__": unittest.main()

