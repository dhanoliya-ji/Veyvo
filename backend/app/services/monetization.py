"""Rewarded ads, Google Play purchases and Veyvo Plus.

Nothing here trusts the client:
- Ad rewards are granted only when AdMob's *signed* server-side-verification (SSV) callback arrives.
- Purchases are granted only after the Google Play Developer API confirms them for this account.
- Every grant uses an idempotency key (ad transaction id / purchase token hash), so it happens once.
Safety features are never sold; these only cover cosmetics, gems and the optional Plus subscription.
"""

import base64
import hashlib
import json
import secrets
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import jwt
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import utcnow
from app.core.exceptions import AppError, Forbidden, NotFound, ServiceUnavailable
from app.core.logging import logger
from app.core.security import hash_token
from app.models import AdRewardSession, Profile, StorePurchase, User
from app.services import rewards

# ----- Catalogue (product ids must match Google Play Console) -----
GEM_PACKS: dict[str, int] = {"gems_100": 100, "gems_550": 550, "gems_1200": 1200}
PLUS_PRODUCT = "veyvo_plus_monthly"
PLUS_MONTHLY_GEMS = 300
PLUS_PERKS = [
    "No ads anywhere",
    f"{PLUS_MONTHLY_GEMS} gems every month",
    "Plus badge on your profile",
    "Host hangouts for up to 100 people",
]


def account_ref(user_id: uuid.UUID) -> str:
    """Opaque id passed to Google Play (obfuscatedAccountId) to bind a purchase to this account."""
    return hashlib.sha256(f"{get_settings().jwt_secret_key}:acct:{user_id}".encode()).hexdigest()[:64]


def plus_active(profile: Profile | None) -> bool:
    return bool(profile and profile.plus_until and profile.plus_until > utcnow())


# =====================================================================
# Rewarded ads
# =====================================================================
AD_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json"
_ad_keys: dict[str, str] = {}
_ad_keys_at = 0.0


def _today_start() -> datetime:
    now = utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def ad_rewards_today(db: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(AdRewardSession)
            .where(AdRewardSession.user_id == user_id, AdRewardSession.status == "granted", AdRewardSession.granted_at >= _today_start())
        )
        or 0
    )


async def start_ad_reward(db: AsyncSession, user: User) -> dict:
    settings = get_settings()
    if not settings.admob_enabled:
        raise ServiceUnavailable("Rewarded ads aren't available right now.", code="ads_unavailable")
    used = await ad_rewards_today(db, user.id)
    if used >= settings.ad_daily_reward_cap:
        raise AppError("You've collected all of today's ad rewards. Come back tomorrow!", code="ad_cap_reached", status_code=429)
    session = AdRewardSession(user_id=user.id, nonce=secrets.token_urlsafe(24))
    db.add(session)
    await db.commit()
    return {"nonce": session.nonce, "gems": settings.ad_reward_gems, "remaining_today": settings.ad_daily_reward_cap - used}


async def ad_reward_status(db: AsyncSession, user: User, nonce: str) -> dict:
    session = await db.scalar(select(AdRewardSession).where(AdRewardSession.nonce == nonce, AdRewardSession.user_id == user.id))
    if session is None:
        raise NotFound("Reward not found.", code="reward_not_found")
    return {"status": session.status, "gems": get_settings().ad_reward_gems if session.status == "granted" else 0}


async def _grant_ad_session(db: AsyncSession, session: AdRewardSession, transaction_id: str) -> bool:
    settings = get_settings()
    if session.status == "granted":
        return False
    if await ad_rewards_today(db, session.user_id) >= settings.ad_daily_reward_cap:
        return False
    reward = await rewards.grant(db, session.user_id, gems=settings.ad_reward_gems, xp=0, reason="rewarded_ad", key=f"ad:{transaction_id}")
    if reward is None:
        return False
    session.status, session.granted_at, session.transaction_id = "granted", utcnow(), transaction_id[:128]
    await db.commit()
    return True


async def _fetch_ad_keys() -> dict[str, str]:
    global _ad_keys, _ad_keys_at
    if _ad_keys and time.monotonic() - _ad_keys_at < 3600:
        return _ad_keys
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(AD_KEYS_URL)
        resp.raise_for_status()
    _ad_keys = {str(k["keyId"]): k["pem"] for k in resp.json().get("keys", [])}
    _ad_keys_at = time.monotonic()
    return _ad_keys


def verify_ssv_signature(query: str, keys: dict[str, str]) -> dict[str, str]:
    """Verify an AdMob SSV callback. The signed message is everything before `&signature=`."""
    marker = "&signature="
    idx = query.find(marker)
    if idx < 0:
        raise Forbidden("Unsigned callback.", code="ssv_invalid")
    message = query[:idx].encode()
    params = {k: v[0] for k, v in parse_qs(query, keep_blank_values=True).items()}
    pem = keys.get(params.get("key_id", ""))
    if not pem or "signature" not in params:
        raise Forbidden("Unknown signing key.", code="ssv_invalid")
    sig = params["signature"]
    signature = base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4))
    public_key = serialization.load_pem_public_key(pem.encode())
    try:
        public_key.verify(signature, message, ec.ECDSA(hashes.SHA256()))  # type: ignore[union-attr]
    except InvalidSignature:
        raise Forbidden("Bad signature.", code="ssv_invalid")
    return params


async def handle_ssv(db: AsyncSession, query: str, keys: dict[str, str] | None = None) -> None:
    params = verify_ssv_signature(query, keys if keys is not None else await _fetch_ad_keys())
    nonce, transaction_id = params.get("custom_data", ""), params.get("transaction_id", "")
    if not nonce or not transaction_id:
        return  # AdMob's console "verify URL" check sends an empty test callback
    session = await db.scalar(select(AdRewardSession).where(AdRewardSession.nonce == nonce))
    if session is None:
        logger.warning("ssv_unknown_nonce")
        return
    await _grant_ad_session(db, session, transaction_id)


async def dev_claim_ad(db: AsyncSession, user: User, nonce: str) -> dict:
    """Development only: Google can't reach a laptop, so simulate the SSV callback locally."""
    if get_settings().app_env != "development":
        raise NotFound("Not found.", code="not_found")
    session = await db.scalar(select(AdRewardSession).where(AdRewardSession.nonce == nonce, AdRewardSession.user_id == user.id))
    if session is None:
        raise NotFound("Reward not found.", code="reward_not_found")
    await _grant_ad_session(db, session, f"dev-{nonce}")
    return await ad_reward_status(db, user, nonce)


# =====================================================================
# Google Play Developer API
# =====================================================================
_PLAY = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
_token_cache: dict[str, float | str] = {}


def _service_account() -> dict:
    raw = get_settings().google_play_service_account.strip()
    if not raw:
        raise ServiceUnavailable("Purchases aren't available yet.", code="billing_unavailable")
    if raw.startswith("{"):
        return json.loads(raw)
    return json.loads(Path(raw).read_text(encoding="utf-8"))


async def _access_token() -> str:
    if _token_cache.get("token") and float(_token_cache.get("exp", 0)) > time.time() + 60:
        return str(_token_cache["token"])
    sa = _service_account()
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": sa["client_email"],
            "scope": "https://www.googleapis.com/auth/androidpublisher",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        sa["private_key"],
        algorithm="RS256",
    )
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        )
        resp.raise_for_status()
    data = resp.json()
    _token_cache.update(token=data["access_token"], exp=now + int(data.get("expires_in", 3600)))
    return data["access_token"]


async def play_request(method: str, path: str) -> dict:
    """Call the Play Developer API. Separate function so tests can replace it."""
    token = await _access_token()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.request(
            method, f"{_PLAY}/{get_settings().google_play_package}/{path}", headers={"Authorization": f"Bearer {token}"}
        )
    if resp.status_code == 404 or resp.status_code == 410:
        raise AppError("Google Play doesn't recognise this purchase.", code="purchase_invalid", status_code=400)
    if resp.status_code >= 400:
        logger.error("play_api_error", extra={"status": resp.status_code})
        raise ServiceUnavailable("Couldn't confirm the purchase with Google Play. Please try again.", code="billing_error")
    return resp.json() if resp.content else {}


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


async def verify_google_purchase(db: AsyncSession, user: User, product_id: str, purchase_token: str) -> dict:
    if not get_settings().billing_configured:
        raise ServiceUnavailable("Purchases aren't available yet.", code="billing_unavailable")
    if product_id not in GEM_PACKS and product_id != PLUS_PRODUCT:
        raise AppError("Unknown product.", code="unknown_product", status_code=422)
    token_hash = hash_token(f"play:{purchase_token}")
    existing = await db.scalar(select(StorePurchase).where(StorePurchase.token_hash == token_hash))
    if existing and existing.user_id not in (None, user.id):
        raise Forbidden("This purchase belongs to another account.", code="purchase_other_account")

    if product_id in GEM_PACKS:
        data = await play_request("GET", f"purchases/products/{product_id}/tokens/{purchase_token}")
        if data.get("purchaseState") != 0:
            raise AppError("This purchase isn't complete yet.", code="purchase_pending", status_code=409)
        ref = data.get("obfuscatedExternalAccountId")
        if ref and ref != account_ref(user.id):
            raise Forbidden("This purchase belongs to another account.", code="purchase_other_account")
        record = existing or StorePurchase(
            user_id=user.id, product_id=product_id, kind="consumable", token_hash=token_hash, purchase_token=purchase_token
        )
        record.order_id, record.state = data.get("orderId"), "purchased"
        db.add(record)
        await rewards.grant(db, user.id, gems=GEM_PACKS[product_id], xp=0, reason="gem_pack", key=f"purchase:{token_hash}")
        await db.commit()
        return await billing_status(db, user)

    data = await play_request("GET", f"purchases/subscriptionsv2/tokens/{purchase_token}")
    state = data.get("subscriptionState", "")
    ref = (data.get("externalAccountIdentifiers") or {}).get("obfuscatedExternalAccountId")
    if ref and ref != account_ref(user.id):
        raise Forbidden("This purchase belongs to another account.", code="purchase_other_account")
    items = data.get("lineItems") or []
    expiry = max((t for t in (_parse_time(i.get("expiryTime")) for i in items) if t), default=None)
    record = existing or StorePurchase(
        user_id=user.id, product_id=product_id, kind="subscription", token_hash=token_hash, purchase_token=purchase_token
    )
    record.order_id, record.state, record.expires_at = data.get("latestOrderId"), state, expiry
    db.add(record)
    await _apply_subscription(db, user.id, record)
    if data.get("acknowledgementState") == "ACKNOWLEDGEMENT_STATE_PENDING" and state == "SUBSCRIPTION_STATE_ACTIVE":
        # Google refunds unacknowledged purchases after 3 days.
        await play_request("POST", f"purchases/subscriptions/{product_id}/tokens/{purchase_token}:acknowledge")
    await db.commit()
    return await billing_status(db, user)


async def _apply_subscription(db: AsyncSession, user_id: uuid.UUID, record: StorePurchase) -> None:
    profile = await db.get(Profile, user_id)
    if profile is None:
        return
    entitled = record.state in ("SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED")
    if entitled and record.expires_at and record.expires_at > utcnow():
        profile.plus_until = max(profile.plus_until or record.expires_at, record.expires_at)
        # Monthly gem allowance: once per billing period (keyed by the period's expiry date).
        await rewards.grant(
            db,
            user_id,
            gems=PLUS_MONTHLY_GEMS,
            xp=0,
            reason="plus_monthly",
            key=f"plus:{record.token_hash}:{record.expires_at.date().isoformat()}",
        )
    elif record.state in (
        "SUBSCRIPTION_STATE_EXPIRED",
        "SUBSCRIPTION_STATE_ON_HOLD",
        "SUBSCRIPTION_STATE_PAUSED",
        "SUBSCRIPTION_STATE_REVOKED",
    ):
        profile.plus_until = min(profile.plus_until or utcnow(), utcnow())


async def handle_rtdn(db: AsyncSession, payload: dict) -> None:
    """Google Play Real-time Developer Notification (via Pub/Sub push). Re-checks the token with Google."""
    try:
        data = json.loads(base64.b64decode(payload["message"]["data"]))
    except (KeyError, ValueError):
        return
    note = data.get("subscriptionNotification")
    if not note:
        return
    token = note.get("purchaseToken", "")
    record = await db.scalar(select(StorePurchase).where(StorePurchase.token_hash == hash_token(f"play:{token}")))
    if record is None or record.user_id is None:
        return
    info = await play_request("GET", f"purchases/subscriptionsv2/tokens/{token}")
    items = info.get("lineItems") or []
    record.state = info.get("subscriptionState", record.state)
    record.expires_at = max((t for t in (_parse_time(i.get("expiryTime")) for i in items) if t), default=record.expires_at)
    await _apply_subscription(db, record.user_id, record)
    await db.commit()


# =====================================================================
# Status
# =====================================================================
async def billing_status(db: AsyncSession, user: User) -> dict:
    settings = get_settings()
    profile = await db.get(Profile, user.id)
    used = await ad_rewards_today(db, user.id)
    return {
        "billing_available": settings.billing_configured,
        "account_ref": account_ref(user.id),
        "gem_packs": [{"product_id": k, "gems": v} for k, v in GEM_PACKS.items()],
        "plus": {
            "product_id": PLUS_PRODUCT,
            "active": plus_active(profile),
            "until": profile.plus_until.isoformat() if profile and profile.plus_until else None,
            "perks": PLUS_PERKS,
        },
        "ads": {
            "enabled": settings.admob_enabled,
            "gems_per_ad": settings.ad_reward_gems,
            "remaining_today": max(0, settings.ad_daily_reward_cap - used),
            "dev_claim": settings.app_env == "development",
        },
        "gems": profile.gems if profile else 0,
    }


def room_capacity_limit(profile: Profile | None) -> int:
    settings = get_settings()
    return settings.plus_room_capacity if plus_active(profile) else settings.max_room_capacity
