from fastapi import APIRouter
import config
from services import weather

router = APIRouter(prefix="/api")


@router.get("/thien-co")
async def thien_co():
    """Vị trí nhà và thời tiết hiện tại cho mục Thiên cơ trên trang chủ."""
    w, err = await weather.get_weather()
    return {"name": config.HOME_NAME, "lat": config.HOME_LAT, "lon": config.HOME_LON, "weather": w, "error": err}
