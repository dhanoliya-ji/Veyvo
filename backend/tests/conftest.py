import os
import tempfile
import uuid
from datetime import date

# Configure the app for tests before anything imports settings.
_tmpdir = tempfile.mkdtemp(prefix="veyvo-test-")
os.environ["APP_ENV"] = "test"
os.environ["REDIS_URL"] = ""
os.environ["LIVEKIT_URL"] = ""
os.environ["LIVEKIT_API_KEY"] = ""
os.environ["LIVEKIT_API_SECRET"] = ""
os.environ["JWT_SECRET_KEY"] = "test-secret-test-secret-test-secret-123"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmpdir}/bootstrap.db"

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.core import database  # noqa: E402
from app.core.store import reset_store  # noqa: E402
from app.main import app, sync_interests  # noqa: E402
from app.models import User  # noqa: E402
from app.websocket.hub import hub  # noqa: E402

ADULT_DOB = date(1995, 6, 15).isoformat()


@pytest.fixture
async def db_url():
    url = f"sqlite+aiosqlite:///{_tmpdir}/{uuid.uuid4().hex}.db"
    database.configure_engine(url)
    async with database.engine.begin() as conn:
        await conn.run_sync(database.Base.metadata.create_all)
    await sync_interests()
    reset_store()
    hub.stop()
    await hub.start()
    yield url
    await database.engine.dispose()


@pytest.fixture
async def client(db_url):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test/api/v1") as c:
        yield c


async def interest_ids(client: httpx.AsyncClient, n: int = 3) -> list[int]:
    r = await client.get("/interests")
    return [i["id"] for i in r.json()[:n]]


async def register(client: httpx.AsyncClient, email: str | None = None, password: str = "hangout123") -> dict:
    email = email or f"user{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/auth/register", json={"email": email, "password": password, "birth_date": ADULT_DOB, "accept_terms": True})
    assert r.status_code == 201, r.text
    data = r.json()
    data["email"] = email
    data["password"] = password
    data["headers"] = {"Authorization": f"Bearer {data['access_token']}"}
    return data


async def make_user(
    client: httpx.AsyncClient, username: str | None = None, interests: list[int] | None = None, privacy: dict | None = None
) -> dict:
    """Register, verify email and complete onboarding. Returns auth data plus `id` and `username`."""
    data = await register(client)
    h = data["headers"]
    r = await client.post("/auth/verify-email", json={"code": data["dev_code"]}, headers=h)
    assert r.status_code == 200, r.text
    username = username or f"user_{uuid.uuid4().hex[:6]}"
    body = {
        "username": username,
        "display_name": username.title(),
        "bio": "Here to hang out",
        "avatar": {
            "skin": "#E0AC69",
            "hair": "curlyTop",
            "hairColor": "#1F1A17",
            "eyes": "round",
            "brows": "soft",
            "mouth": "smile",
            "outfit": "hoodie",
            "outfitColor": "#9385FF",
            "accessory": "none",
            "bg": "#2A2650",
        },
        "interest_ids": interests or await interest_ids(client),
    }
    if privacy:
        body["privacy"] = privacy
    r = await client.post("/me/onboarding", json=body, headers=h)
    assert r.status_code == 200, r.text
    data["id"] = r.json()["id"]
    data["username"] = username
    return data


async def befriend(client: httpx.AsyncClient, a: dict, b: dict) -> None:
    r = await client.post("/friends/requests", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/friends/requests/{r.json()['request_id']}/accept", headers=b["headers"])
    assert r.status_code == 200, r.text


async def set_role(email: str, role: str) -> None:
    from sqlalchemy import select

    async with database.session_factory()() as db:
        user = await db.scalar(select(User).where(User.email == email))
        user.role = role
        await db.commit()
