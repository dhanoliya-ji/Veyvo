from app.core.config import Settings


def test_render_style_database_urls_use_asyncpg():
    for raw in ("postgres://u:p@h:5432/db", "postgresql://u:p@h:5432/db"):
        assert Settings(database_url=raw).database_url == "postgresql+asyncpg://u:p@h:5432/db"
    assert Settings(database_url="postgresql+asyncpg://u:p@h/db").database_url == "postgresql+asyncpg://u:p@h/db"
    assert Settings(database_url="sqlite+aiosqlite:///./x.db").database_url.startswith("sqlite")
