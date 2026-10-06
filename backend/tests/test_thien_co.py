"""Kiểm tra API thời tiết của mục Thiên cơ. Không gọi mạng thật."""
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db
TEMP = tempfile.TemporaryDirectory()
db.DB_PATH = Path(TEMP.name) / "test.db"
from fastapi.testclient import TestClient
from main import app
from services import weather

GOOD = {"current": {"time": "2026-10-03T19:00", "temperature_2m": 29.6, "apparent_temperature": 34.2,
                    "relative_humidity_2m": 78, "weather_code": 80, "wind_speed_10m": 11.4, "is_day": 0}}


def run(coro):
    return asyncio.run(coro)


class WeatherTests(unittest.TestCase):
    def setUp(self):
        weather.clear_cache()

    def test_parse_and_round(self):
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json=GOOD)
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as cl:
                a = await weather.get_weather(cl)
                b = await weather.get_weather(cl)  # lần hai lấy từ bộ nhớ đệm
                return a, b
        a, b = run(go())
        self.assertEqual(a[1], None)
        self.assertEqual(a[0], {"temp": 30, "feels": 34, "humidity": 78, "wind": 11, "code": 80, "is_day": False, "time": "2026-10-03T19:00"})
        self.assertEqual(a, b)
        self.assertEqual(len(calls), 1)

    def test_network_error_gives_message_not_exception(self):
        def handler(request):
            raise httpx.ConnectError("không có mạng")
        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as cl:
                return await weather.get_weather(cl)
        w, err = run(go())
        self.assertIsNone(w)
        self.assertIn("ConnectError", err)

    def test_bad_payload_and_http_status(self):
        for resp in (httpx.Response(200, json={"current": {}}), httpx.Response(429, json={})):
            weather.clear_cache()
            async def go():
                async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: resp)) as cl:
                    return await weather.get_weather(cl)
            w, err = run(go())
            self.assertIsNone(w)
            self.assertTrue(err)

    def test_endpoint_shape(self):
        with patch.object(weather, "get_weather", AsyncMock(return_value=({"temp": 30}, None))):
            j = TestClient(app).get("/api/thien-co").json()
        self.assertEqual(set(j), {"name", "lat", "lon", "weather", "error"})
        self.assertEqual(j["weather"], {"temp": 30})
        with patch.object(weather, "get_weather", AsyncMock(return_value=(None, "lỗi"))):
            j = TestClient(app).get("/api/thien-co").json()
        self.assertIsNone(j["weather"])
        self.assertEqual(j["error"], "lỗi")


if __name__ == "__main__":
    unittest.main()
