"""User-operated web chat: prompt, encrypted import and stable page ownership."""
import unittest
from unittest.mock import patch

import test_translation
from routers import library, translation
from services import chess_translation


class WebChatTests(unittest.TestCase):
    setUp = test_translation.TranslationTests.setUp
    tearDown = test_translation.TranslationTests.tearDown

    def source(self, **changes):
        return {"page": 1, "text": "White plays Nf3 and O-O. The bishop controls e4.",
                "glossary": "bishop=quân tượng", **changes}

    def imported(self, **changes):
        return {**self.source(), "provider": "claude",
                "translation": "Trắng đi Nf3 và O-O. Quân tượng kiểm soát e4.", **changes}

    def test_prompt_uses_chess_context_without_sending_to_any_provider(self):
        source = self.source(text="8.Bd3\nThe natural square for the bishop. It controls e4 and points at h7.\nRb.Rb.Rb.Rb.Rb.Rb.")
        with patch.object(translation.httpx, "AsyncClient", side_effect=AssertionError("No provider calls")):
            result = self.client.post(self.base + "/web/prompt", json=source)
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()
        self.assertEqual(data["text"], source["text"], "Capture exactly the source the reader is editing")
        self.assertEqual(data["page"], 1)
        self.assertIn("Dịch trọn câu", data["prompt"])
        self.assertIn("bishop=quân tượng", data["prompt"])
        self.assertIn("8.Bd3", data["prompt"])
        self.assertIn("points at h7.", data["prompt"])
        self.assertNotIn("Rb.Rb", data["prompt"])
        self.assertNotIn("__THC_MOVE", data["prompt"])
        self.assertIsNone(self.client.get(self.base + "/web?page=1").json()["translation"])

    def test_import_is_encrypted_and_page_provider_source_survive_reopening(self):
        for provider, page in (("claude", 1), ("gemini", 2)):
            body = self.imported(provider=provider, page=page)
            with patch.object(translation.httpx, "AsyncClient", side_effect=AssertionError("No provider calls")):
                result = self.client.post(self.base + "/web/import", json=body)
            self.assertEqual(result.status_code, 200, result.text)
            saved = self.client.get(self.base + f"/web?page={page}").json()
            for field in ("text", "translation", "provider", "page", "glossary"):
                self.assertEqual(saved[field], body[field])
            # Reviewed manual translations do not expire when the AI pipeline changes.
            with patch.object(chess_translation, "REVISION", "future-pipeline"):
                self.assertEqual(self.client.get(self.base + f"/web?page={page}").json()["translation"], body["translation"])
        files = list((library._blob_dir() / "translations").glob("*.thc"))
        self.assertTrue(files)
        for file in files:
            self.assertNotIn(b"White plays", file.read_bytes())
            self.assertNotIn("Quân tượng".encode(), file.read_bytes())
        self.client.put(self.base + "/state", json={"page": 2, "translation_mode": "web"})
        self.assertEqual(self.client.get(self.base + "/state").json()["translation_mode"], "web")
        self.client.put(self.base + "/state", json={"page": 1, "translation_mode": "automatic"})
        self.assertEqual(self.client.get(self.base + "/state").json()["translation_mode"], "automatic")

    def test_changed_or_missing_moves_do_not_replace_a_good_translation(self):
        body = self.imported()
        self.assertEqual(self.client.post(self.base + "/web/import", json=body).status_code, 200)
        for bad in ("Trắng đi Nf3.", "Trắng đi O-O và Nf3. Quân tượng kiểm soát e4.",
                    "Tháng BaCoptic month 12 - LongName", "   "):
            result = self.client.post(self.base + "/web/import", json={**body, "translation": bad})
            self.assertEqual(result.status_code, 422, result.text)
            self.assertEqual(self.client.get(self.base + "/web?page=1").json()["translation"], body["translation"])

    def test_web_import_keeps_auto_cache_and_book_progress_separate(self):
        body = self.imported()
        auto = translation.Translate(**self.source(), model="qwen3:1.7b")
        row = translation.book(self.item); key = library._state["key"]
        path = translation.translation_path(row, key, auto)
        translation.write_cache(path, key, {"translation": "Existing automatic translation"})
        job = self.client.post(self.base + "/batch/start", json={"model": "qwen3:1.7b", "start": 1, "end": 2}).json()
        self.assertEqual(self.client.post(self.base + "/web/import", json=body).status_code, 200)
        self.assertEqual(translation.read_cache(path, key)["translation"], "Existing automatic translation")
        current = self.client.get(self.base + "/batch").json()
        self.assertEqual(current["signature"], job["signature"])
        self.assertEqual(current["done"], 0)

    def test_validation_and_vault_guard_apply_to_all_web_actions(self):
        for endpoint in ("prompt", "import"):
            for invalid in ({"page": 3}, {"page": 0}, {"text": "   "}, {"text": "x" * 12001}):
                result = self.client.post(self.base + "/web/" + endpoint, json=self.imported(**invalid))
                self.assertIn(result.status_code, (400, 422), result.text)
        self.assertEqual(self.client.get(self.base + "/web?page=3").status_code, 400)
        self.assertEqual(self.client.post(self.base + "/web/import", json=self.imported(provider="unexpected")).status_code, 422)
        self.assertEqual(self.client.post(self.base + "/web/prompt", json=self.source(), follow_redirects=False).status_code, 200)
        self.assertEqual(self.client.post(self.base.replace(str(self.item), "999999") + "/web/prompt", json=self.source()).status_code, 404)
        self.client.post("/api/library/vault/lock")
        self.assertEqual(self.client.get(self.base + "/web?page=1").status_code, 401)
        for endpoint in ("prompt", "import"):
            self.assertEqual(self.client.post(self.base + "/web/" + endpoint, json=self.imported()).status_code, 401)


if __name__ == "__main__":
    unittest.main()
