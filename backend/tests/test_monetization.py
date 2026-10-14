import base64
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.core import database
from app.core.config import get_settings
from app.core.exceptions import Forbidden
from app.services import monetization
from tests.conftest import make_user


@pytest.fixture
def ads_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "admob_enabled", True)
    monkeypatch.setattr(s, "ad_daily_reward_cap", 2)
    monkeypatch.setattr(s, "app_env", "development")  # enables the local dev-claim path
    return s


@pytest.fixture
def billing_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "google_play_service_account", '{"client_email":"x","private_key":"y"}')
    calls = []

    async def fake_play(method, path):
        calls.append((method, path))
        return fake_play.responses[path.split("/tokens/")[0] if "/tokens/" in path else path]

    fake_play.responses = {}
    monkeypatch.setattr(monetization, "play_request", fake_play)
    fake_play.calls = calls
    return fake_play


def _signed_query(params: dict, key: ec.EllipticCurvePrivateKey, key_id: str = "123") -> str:
    q = urlencode({**params, "key_id": key_id})
    sig = key.sign(q.encode(), ec.ECDSA(hashes.SHA256()))
    return f"{q}&signature={base64.urlsafe_b64encode(sig).decode().rstrip('=')}"


def _pem(key: ec.EllipticCurvePrivateKey) -> str:
    return key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()


async def test_ads_disabled_by_default(client):
    u = await make_user(client)
    r = await client.post("/ads/rewards", headers=u["headers"])
    assert r.status_code == 503 and r.json()["error"]["code"] == "ads_unavailable"
    status = (await client.get("/billing/status", headers=u["headers"])).json()
    assert status["ads"]["enabled"] is False and status["billing_available"] is False


async def test_ad_reward_only_with_valid_signature(client, ads_on):
    u = await make_user(client)
    nonce = (await client.post("/ads/rewards", headers=u["headers"])).json()["nonce"]
    gems_before = (await client.get("/me", headers=u["headers"])).json()["gems"]
    key, other = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    keys = {"123": _pem(key)}

    # A forged callback (signed with a different key) is rejected and grants nothing.
    async with database.session_factory()() as db:
        with pytest.raises(Forbidden):
            await monetization.handle_ssv(db, _signed_query({"custom_data": nonce, "transaction_id": "t1"}, other), keys)
    assert (await client.get(f"/ads/rewards/{nonce}", headers=u["headers"])).json()["status"] == "pending"

    good = _signed_query({"custom_data": nonce, "transaction_id": "t1", "reward_amount": "1"}, key)
    async with database.session_factory()() as db:
        await monetization.handle_ssv(db, good, keys)
        await monetization.handle_ssv(db, good, keys)  # replay: still granted once
    assert (await client.get(f"/ads/rewards/{nonce}", headers=u["headers"])).json()["status"] == "granted"
    assert (await client.get("/me", headers=u["headers"])).json()["gems"] == gems_before + ads_on.ad_reward_gems


async def test_ad_daily_cap(client, ads_on):
    u = await make_user(client)
    for _ in range(2):
        nonce = (await client.post("/ads/rewards", headers=u["headers"])).json()["nonce"]
        await client.post(f"/ads/rewards/{nonce}/dev-claim", headers=u["headers"])
    r = await client.post("/ads/rewards", headers=u["headers"])
    assert r.status_code == 429 and r.json()["error"]["code"] == "ad_cap_reached"


async def test_dev_claim_only_in_development(client, ads_on, monkeypatch):
    u = await make_user(client)
    nonce = (await client.post("/ads/rewards", headers=u["headers"])).json()["nonce"]
    monkeypatch.setattr(ads_on, "app_env", "production")
    assert (await client.post(f"/ads/rewards/{nonce}/dev-claim", headers=u["headers"])).status_code == 404
    monkeypatch.setattr(ads_on, "app_env", "development")
    other = await make_user(client)
    assert (await client.post(f"/ads/rewards/{nonce}/dev-claim", headers=other["headers"])).status_code == 404


async def test_purchase_unavailable_without_billing(client):
    u = await make_user(client)
    r = await client.post(
        "/billing/google/verify", json={"product_id": "gems_100", "purchase_token": "tok-1234567890"}, headers=u["headers"]
    )
    assert r.status_code == 503 and r.json()["error"]["code"] == "billing_unavailable"


async def test_gem_pack_verified_once_and_bound_to_account(client, billing_on):
    u, thief = await make_user(client), await make_user(client)
    billing_on.responses["purchases/products/gems_550"] = {
        "purchaseState": 0,
        "orderId": "GPA.1",
        "obfuscatedExternalAccountId": monetization.account_ref(__import__("uuid").UUID(u["id"])),
    }
    before = (await client.get("/me", headers=u["headers"])).json()["gems"]
    body = {"product_id": "gems_550", "purchase_token": "token-abcdefghij"}
    r1 = await client.post("/billing/google/verify", json=body, headers=u["headers"])
    r2 = await client.post("/billing/google/verify", json=body, headers=u["headers"])
    assert r1.status_code == 200 and r2.status_code == 200
    assert (await client.get("/me", headers=u["headers"])).json()["gems"] == before + 550  # granted exactly once
    # Someone else can't redeem the same token.
    assert (await client.post("/billing/google/verify", json=body, headers=thief["headers"])).status_code == 403


async def test_pending_purchase_and_unknown_product(client, billing_on):
    u = await make_user(client)
    billing_on.responses["purchases/products/gems_100"] = {"purchaseState": 2}
    r = await client.post(
        "/billing/google/verify", json={"product_id": "gems_100", "purchase_token": "token-pending-1"}, headers=u["headers"]
    )
    assert r.status_code == 409
    r = await client.post(
        "/billing/google/verify", json={"product_id": "free_money", "purchase_token": "token-pending-1"}, headers=u["headers"]
    )
    assert r.status_code == 422


async def test_plus_subscription_entitlement_and_acknowledge(client, billing_on):
    u = await make_user(client)
    expiry = (datetime.now(UTC) + timedelta(days=30)).isoformat().replace("+00:00", "Z")
    billing_on.responses["purchases/subscriptionsv2"] = {
        "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
        "acknowledgementState": "ACKNOWLEDGEMENT_STATE_PENDING",
        "lineItems": [{"productId": "veyvo_plus_monthly", "expiryTime": expiry}],
    }
    billing_on.responses[f"purchases/subscriptions/{monetization.PLUS_PRODUCT}"] = {}
    before = (await client.get("/me", headers=u["headers"])).json()["gems"]
    r = await client.post(
        "/billing/google/verify", json={"product_id": monetization.PLUS_PRODUCT, "purchase_token": "sub-token-123456"}, headers=u["headers"]
    )
    assert r.status_code == 200 and r.json()["plus"]["active"] is True
    me = (await client.get("/me", headers=u["headers"])).json()
    assert me["plus_active"] is True and me["gems"] == before + monetization.PLUS_MONTHLY_GEMS
    assert any(m == "POST" and p.endswith(":acknowledge") for m, p in billing_on.calls)
    # Plus hosts can open bigger rooms.
    r = await client.post("/rooms", json={"title": "Big hangout", "capacity": 80}, headers=u["headers"])
    assert r.status_code == 201


async def test_room_capacity_limited_without_plus(client):
    u = await make_user(client)
    r = await client.post("/rooms", json={"title": "Big hangout", "capacity": 80}, headers=u["headers"])
    assert r.status_code == 422


async def test_rtdn_requires_token(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "google_rtdn_token", "s3cret")
    assert (await client.post("/billing/google/rtdn?token=nope", json={})).status_code == 403
    assert (await client.post("/billing/google/rtdn?token=s3cret", json={"message": {"data": ""}})).status_code == 200
