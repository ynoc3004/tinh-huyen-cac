"""Thời tiết hiện tại từ Open-Meteo (miễn phí, không cần khóa). Có bộ nhớ đệm để không gọi liên tục."""
import time
import httpx
import config

URL = "https://api.open-meteo.com/v1/forecast"
CACHE_OK = 600    # giây: kết quả tốt giữ 10 phút
CACHE_FAIL = 60   # giây: lỗi chỉ giữ 1 phút rồi thử lại
_cache = {"at": 0.0, "ttl": 0, "value": None}


def _parse(j):
    cur = j["current"]
    return {
        "temp": round(float(cur["temperature_2m"])),
        "feels": round(float(cur["apparent_temperature"])),
        "humidity": round(float(cur["relative_humidity_2m"])),
        "wind": round(float(cur["wind_speed_10m"])),
        "code": int(cur["weather_code"]),
        "is_day": bool(cur["is_day"]),
        "time": str(cur.get("time", "")),
    }


async def get_weather(client=None):
    """Trả về (thời tiết hoặc None, thông báo lỗi hoặc None)."""
    now = time.monotonic()
    if _cache["ttl"] and now - _cache["at"] < _cache["ttl"]:
        return _cache["value"]
    params = {
        "latitude": config.HOME_LAT, "longitude": config.HOME_LON, "timezone": "auto",
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    }
    own = client is None
    cl = client or httpx.AsyncClient(headers=config.UA, timeout=10, follow_redirects=True)
    try:
        r = await cl.get(URL, params=params)
        r.raise_for_status()
        result = (_parse(r.json()), None)
        ttl = CACHE_OK
    except httpx.HTTPError as e:
        result, ttl = (None, f"Không kết nối được máy chủ thời tiết ({type(e).__name__})"), CACHE_FAIL
    except (ValueError, KeyError, TypeError):
        result, ttl = (None, "Máy chủ thời tiết trả dữ liệu không đọc được"), CACHE_FAIL
    finally:
        if own:
            await cl.aclose()
    _cache.update(at=now, ttl=ttl, value=result)
    return result


def clear_cache():
    _cache.update(at=0.0, ttl=0, value=None)
