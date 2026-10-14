from collections.abc import AsyncIterator
from datetime import UTC, datetime

from sqlalchemy import DateTime, MetaData, event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import get_settings

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


def _make_engine(url: str) -> AsyncEngine:
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs = {"connect_args": {"check_same_thread": False}}
    engine = create_async_engine(url, **kwargs)
    if url.startswith("sqlite"):
        # SQLite needs foreign keys switched on per connection so ON DELETE rules behave like Postgres.
        @event.listens_for(engine.sync_engine, "connect")
        def _fk_pragma(dbapi_conn, _record):  # pragma: no cover - driver hook
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine: AsyncEngine = _make_engine(get_settings().database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def configure_engine(url: str) -> None:
    """Swap the global engine (used by tests)."""
    global engine, SessionLocal
    engine = _make_engine(url)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


def session_factory() -> async_sessionmaker[AsyncSession]:
    return SessionLocal


def is_sqlite() -> bool:
    return engine.url.get_backend_name() == "sqlite"
