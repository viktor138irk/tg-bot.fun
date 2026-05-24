import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from database import init_db

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("botfactory")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting BotFactory API...")
    await init_db()
    logger.info("Database initialized")
    yield
    logger.info("Shutting down BotFactory API")


app = FastAPI(
    title="BotFactory API",
    version="2.1.0",
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

upload_path = Path(settings.UPLOAD_DIR)
upload_path.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(upload_path)), name="uploads")


@app.get("/api/health", tags=["System"])
async def health():
    return {"status": "ok", "version": "2.1.0"}


@app.get("/api/version", tags=["System"])
async def version():
    return {
        "version": "2.1.0",
        "debug": settings.DEBUG,
        "domain": settings.DOMAIN or None,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.DEBUG,
        loop="uvloop",
    )
