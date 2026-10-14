from datetime import date, timedelta

import jwt

from tests.conftest import ADULT_DOB, make_user, register


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["database"] is True


async def test_register_requires_adult_and_stores_no_birth_date(client):
    today = date.today()
    minor = today.replace(year=today.year - 17).isoformat()
    r = await client.post(
        "/auth/register", json={"email": "kid@example.com", "password": "hangout123", "birth_date": minor, "accept_terms": True}
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "underage"

    # Nothing about the minor is stored: the same email can't log in and isn't "taken".
    r = await client.post("/auth/login", json={"email": "kid@example.com", "password": "hangout123"})
    assert r.status_code == 401

    data = await register(client, email="adult@example.com")
    me = await client.get("/me", headers=data["headers"])
    assert me.status_code == 200
    assert "birth_date" not in me.text


async def test_register_validation(client):
    r = await client.post(
        "/auth/register", json={"email": "x@example.com", "password": "short", "birth_date": ADULT_DOB, "accept_terms": True}
    )
    assert r.status_code == 422
    r = await client.post(
        "/auth/register", json={"email": "x@example.com", "password": "password123", "birth_date": ADULT_DOB, "accept_terms": True}
    )
    assert r.status_code == 422
    r = await client.post(
        "/auth/register", json={"email": "x@example.com", "password": "hangout123", "birth_date": ADULT_DOB, "accept_terms": False}
    )
    assert r.status_code == 422
    future = (date.today() + timedelta(days=3)).isoformat()
    r = await client.post(
        "/auth/register", json={"email": "x@example.com", "password": "hangout123", "birth_date": future, "accept_terms": True}
    )
    assert r.status_code == 422


async def test_duplicate_email(client):
    await register(client, email="dup@example.com")
    r = await client.post(
        "/auth/register", json={"email": "DUP@example.com", "password": "hangout123", "birth_date": ADULT_DOB, "accept_terms": True}
    )
    assert r.status_code == 409


async def test_login_and_invalid_credentials(client):
    data = await register(client, email="login@example.com")
    r = await client.post("/auth/login", json={"email": "login@example.com", "password": "wrongpass1"})
    assert r.status_code == 401
    assert r.json()["error"]["message"] == "Email or password is incorrect."
    r = await client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrongpass1"})
    assert r.status_code == 401
    r = await client.post("/auth/login", json={"email": "login@example.com", "password": data["password"]})
    assert r.status_code == 200
    assert r.json()["access_token"]


async def test_tokens_expired_and_tampered(client):
    data = await register(client)
    token = data["access_token"]
    payload = jwt.decode(token, options={"verify_signature": False})
    tampered = jwt.encode({**payload, "role": "admin"}, "not-the-secret", algorithm="HS256")
    r = await client.get("/me", headers={"Authorization": f"Bearer {tampered}"})
    assert r.status_code == 401
    expired = jwt.encode({**payload, "exp": payload["iat"] - 10}, "test-secret-test-secret-test-secret-123", algorithm="HS256")
    r = await client.get("/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    r = await client.get("/me")
    assert r.status_code == 401


async def test_refresh_rotation_and_reuse_detection(client):
    data = await register(client)
    r = await client.post("/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert r.status_code == 200
    new = r.json()
    # Replaying the old token revokes the whole session.
    r = await client.post("/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert r.status_code == 401
    r = await client.post("/auth/refresh", json={"refresh_token": new["refresh_token"]})
    assert r.status_code == 401
    r = await client.get("/me", headers={"Authorization": f"Bearer {new['access_token']}"})
    assert r.status_code == 401


async def test_logout_revokes_session(client):
    data = await register(client)
    r = await client.post("/auth/logout", headers=data["headers"])
    assert r.status_code == 200
    r = await client.get("/me", headers=data["headers"])
    assert r.status_code == 401


async def test_email_verification_and_onboarding_gate(client):
    data = await register(client)
    h = data["headers"]
    r = await client.get("/home", headers=h)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "email_unverified"
    r = await client.post("/auth/verify-email", json={"code": "000000" if data["dev_code"] != "000000" else "111111"}, headers=h)
    assert r.status_code == 400
    r = await client.post("/auth/verify-email", json={"code": data["dev_code"]}, headers=h)
    assert r.status_code == 200
    r = await client.get("/home", headers=h)
    assert r.json()["error"]["code"] == "onboarding_required"


async def test_password_reset_flow(client):
    data = await register(client, email="reset@example.com")
    r = await client.post("/auth/forgot-password", json={"email": "missing@example.com"})
    assert r.status_code == 200  # same answer for unknown emails
    r = await client.post("/auth/forgot-password", json={"email": "reset@example.com"})
    code = r.json()["dev_code"]
    r = await client.post("/auth/reset-password", json={"email": "reset@example.com", "code": code, "new_password": "brandnew42"})
    assert r.status_code == 200
    # Old sessions are revoked after a reset.
    assert (await client.get("/me", headers=data["headers"])).status_code == 401
    r = await client.post("/auth/login", json={"email": "reset@example.com", "password": "brandnew42"})
    assert r.status_code == 200
    # Codes are single-use.
    r = await client.post("/auth/reset-password", json={"email": "reset@example.com", "code": code, "new_password": "another42x"})
    assert r.status_code == 400


async def test_login_rate_limit(client):
    await register(client, email="rl@example.com")
    codes = []
    for _ in range(10):
        r = await client.post("/auth/login", json={"email": "rl@example.com", "password": "wrongpass1"})
        codes.append(r.status_code)
    assert 429 in codes


async def test_onboarding_username_rules(client):
    user = await make_user(client, username="taken_name")
    other = await register(client)
    h = other["headers"]
    await client.post("/auth/verify-email", json={"code": other["dev_code"]}, headers=h)
    r = await client.get("/me/username-check", params={"username": "Taken_Name"}, headers=h)
    assert r.json()["available"] is False
    r = await client.get("/me/username-check", params={"username": "admin"}, headers=h)
    assert r.json()["available"] is False
    r = await client.get("/me/username-check", params={"username": "a!"}, headers=h)
    assert r.json()["available"] is False
    assert user["username"] == "taken_name"
