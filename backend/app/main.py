import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from app.api.routes import auth, communities, conversations, engagement, games, me, moments, monetization, rooms, safety, users
from app.content.catalog import INTERESTS
from app.core import database
from app.core.config import get_settings
from app.core.exceptions import install_exception_handlers
from app.core.logging import configure_logging, logger
from app.core.store import get_store
from app.models import Interest
from app.services.account import purge_expired
from app.web import pages
from app.websocket import routes as ws_routes
from app.websocket.hub import hub

API_PREFIX = "/api/v1"


async def sync_interests() -> None:
    """Make sure the interest catalogue exists (idempotent; safe in every environment)."""
    async with database.session_factory()() as db:
        existing = {i.slug: i for i in await db.scalars(select(Interest))}
        for item in INTERESTS:
            row = existing.get(item["slug"])
            if row is None:
                db.add(Interest(**item))
            else:
                row.name, row.category, row.icon, row.active = item["name"], item["category"], item["icon"], True
        await db.commit()


async def _retention_loop() -> None:
    while True:
        try:
            async with database.session_factory()() as db:
                counts = await purge_expired(db)
            logger.info("retention_purge", extra=counts)
        except Exception:
            logger.exception("retention_purge_failed")
        await asyncio.sleep(6 * 3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging()
    settings.validate_for_production()
    if settings.app_env != "test":
        await sync_interests()
    await hub.start()
    task = asyncio.create_task(_retention_loop()) if settings.app_env != "test" else None
    logger.info("startup", extra={"env": settings.app_env, "media": settings.media_configured, "redis": bool(settings.redis_url)})
    yield
    if task:
        task.cancel()
    hub.stop()
    await get_store().close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Veyvo API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    install_exception_handlers(app)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith(API_PREFIX):
            response.headers.setdefault("Cache-Control", "no-store")
        if settings.is_production:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    @app.get(f"{API_PREFIX}/health", tags=["health"])
    async def health():
        db_ok = True
        try:
            async with database.session_factory()() as db:
                await db.execute(text("SELECT 1"))
        except Exception:
            db_ok = False
        return {"status": "ok" if db_ok else "degraded", "database": db_ok, "media": settings.media_configured}

    for module in (auth, me, users, conversations, rooms, communities, games, engagement, moments, monetization, safety):
        app.include_router(module.router, prefix=API_PREFIX)
    app.include_router(ws_routes.router)
    app.include_router(pages.router)
    return app


app = create_app()
