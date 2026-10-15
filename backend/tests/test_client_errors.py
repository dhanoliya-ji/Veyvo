import logging

from app.api.routes.client_errors import scrub
from app.core import sentry
from app.services.rate_limit import LIMITS

REPORT = {
    "message": "TypeError: undefined is not an object (evaluating 'room.members')",
    "stack": "at RoomScreen (room.tsx:12:4)\nat renderWithHooks (index.android.bundle:1:2)",
    "is_fatal": True,
    "source": "global",
    "app_version": "1.2.0",
    "platform": "android",
    "os_version": "34",
    "route": "room/[id]",
    "timestamp": "2026-10-16T10:00:00Z",
    "install_id": "6f1c2a9e-4b7d-4c1e-9a3f-0d2b8e7c5a11",
}


async def test_accepts_valid_report_without_auth(client, caplog):
    with caplog.at_level(logging.WARNING, logger="veyvo"):
        r = await client.post("/client-errors", json=REPORT)
    assert r.status_code == 202, r.text
    assert r.json() == {"ok": True}
    records = [rec for rec in caplog.records if rec.getMessage() == "client_error"]
    assert records and records[0].route == "room/[id]" and records[0].is_fatal is True


async def test_minimal_report(client):
    r = await client.post("/client-errors", json={"message": "Boom"})
    assert r.status_code == 202, r.text


async def test_ignores_auth_header_and_works_signed_out(client):
    r = await client.post("/client-errors", json=REPORT, headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 202, r.text


async def test_rejects_oversized_fields(client):
    assert (await client.post("/client-errors", json={**REPORT, "message": "x" * 501})).status_code == 422
    assert (await client.post("/client-errors", json={**REPORT, "stack": "y" * 4001})).status_code == 422
    assert (await client.post("/client-errors", json={**REPORT, "route": "r" * 201})).status_code == 422
    assert (await client.post("/client-errors", json={**REPORT, "app_version": "v" * 33})).status_code == 422


async def test_rejects_invalid_fields(client):
    assert (await client.post("/client-errors", json={**REPORT, "message": ""})).status_code == 422
    assert (await client.post("/client-errors", json={**REPORT, "platform": "toaster"})).status_code == 422
    assert (await client.post("/client-errors", json={**REPORT, "install_id": "me@example.com"})).status_code == 422
    assert (await client.post("/client-errors", json={"stack": "no message"})).status_code == 422


async def test_rate_limited_per_ip(client):
    limit, _window = LIMITS["client_error"]
    for _ in range(limit):
        assert (await client.post("/client-errors", json=REPORT)).status_code == 202
    r = await client.post("/client-errors", json=REPORT)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "rate_limited"


async def test_forwards_to_sentry_only_when_enabled(client, monkeypatch):
    sent = []
    monkeypatch.setattr(sentry, "capture_client_error", lambda report: sent.append(report))
    r = await client.post("/client-errors", json={**REPORT, "message": "Failed for sam@example.com"})
    assert r.status_code == 202
    assert sent and sent[0]["message"] == "Failed for [email]"


def test_scrub_removes_personal_data_and_paths():
    text = (
        "Error for sam@example.com Bearer abc.def eyJhbGciOi.eyJzdWIiOi.c2ln "
        "user 6f1c2a9e-4b7d-4c1e-9a3f-0d2b8e7c5a11 phone 5551234567 "
        "at /data/user/0/app.veyvo/files/index.android.bundle:1:2 C:\\Users\\sam\\app\\src\\screen.tsx:3"
    )
    out = scrub(text)
    for leaked in ("sam@example.com", "abc.def", "eyJhbGciOi", "6f1c2a9e", "5551234567", "/data/user", "Users\\sam"):
        assert leaked not in out
    assert "index.android.bundle:1:2" in out and "screen.tsx:3" in out


def test_sentry_before_send_drops_bodies_cookies_and_credentials():
    event = {
        "request": {
            "data": {"password": "hunter2"},
            "cookies": {"session": "x"},
            "headers": {"Authorization": "Bearer secret", "X-Forwarded-For": "1.2.3.4", "User-Agent": "okhttp"},
        },
        "user": {"ip_address": "1.2.3.4"},
    }
    out = sentry.scrub_event(event)
    assert "data" not in out["request"] and "cookies" not in out["request"] and "user" not in out
    assert out["request"]["headers"] == {"User-Agent": "okhttp"}
