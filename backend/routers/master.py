import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from config import MASTER_URL
router = APIRouter(prefix="/api/master")
class Chat(BaseModel): message: str; context: dict | None = None
@router.post("/chat")
async def chat(b: Chat):
    if not MASTER_URL: return {"reply": "Sư phụ đang bế quan."}
    async with httpx.AsyncClient(timeout=120) as cl:
        return (await cl.post(MASTER_URL, json=b.model_dump())).json()  # định dạng: {message, context} -> {reply}
