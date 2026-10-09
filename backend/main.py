from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import db
import os, secrets, base64
from starlette.responses import Response
from routers import core, library, master, arena, thien_co, bi_canh, translation, reviews
db.init()
app = FastAPI(title="Tĩnh Huyền Các")
ACCESS_PASSWORD = os.getenv("ACCESS_PASSWORD", "")

@app.middleware("http")
async def access_control(request, call_next):
    if ACCESS_PASSWORD:
        supplied = ""
        try:
            scheme, encoded = request.headers.get("authorization", "").split(" ", 1)
            if scheme.lower() == "basic":
                _, supplied = base64.b64decode(encoded, validate=True).decode().split(":", 1)
        except (ValueError, UnicodeError):
            pass
        if not secrets.compare_digest(supplied, ACCESS_PASSWORD):
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Tinh Huyen Cac", charset="UTF-8"'})
    return await call_next(request)

for r in (core, library, master, arena, thien_co, bi_canh, translation, reviews): app.include_router(r.router)
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True))
