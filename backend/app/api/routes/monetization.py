import hmac

from fastapi import APIRouter, Query, Request
from pydantic import Field

from app.api.dependencies import DB, ActiveUser
from app.core.config import get_settings
from app.core.exceptions import Forbidden
from app.schemas.common import ApiModel, Ok
from app.services import monetization
from app.services.rate_limit import hit

router = APIRouter(tags=["monetization"])


class VerifyPurchaseIn(ApiModel):
    product_id: str = Field(min_length=1, max_length=80)
    purchase_token: str = Field(min_length=10, max_length=4096)


@router.get("/billing/status")
async def billing_status(user: ActiveUser, db: DB):
    return await monetization.billing_status(db, user)


@router.post("/billing/google/verify")
async def verify_google(body: VerifyPurchaseIn, user: ActiveUser, db: DB):
    await hit("purchase", str(user.id))
    return await monetization.verify_google_purchase(db, user, body.product_id, body.purchase_token)


@router.post("/billing/google/rtdn", response_model=Ok, include_in_schema=False)
async def google_rtdn(request: Request, db: DB, token: str = Query(default="", max_length=200)):
    """Pub/Sub push endpoint for Play Real-time Developer Notifications (subscription renewals, cancels)."""
    expected = get_settings().google_rtdn_token
    if not expected or not hmac.compare_digest(token, expected):
        raise Forbidden("Not allowed.", code="forbidden")
    await monetization.handle_rtdn(db, await request.json())
    return Ok()


@router.post("/ads/rewards")
async def start_reward(user: ActiveUser, db: DB):
    await hit("ad_reward", str(user.id))
    return await monetization.start_ad_reward(db, user)


@router.get("/ads/rewards/{nonce}")
async def reward_status(nonce: str, user: ActiveUser, db: DB):
    return await monetization.ad_reward_status(db, user, nonce[:64])


@router.post("/ads/rewards/{nonce}/dev-claim")
async def dev_claim(nonce: str, user: ActiveUser, db: DB):
    return await monetization.dev_claim_ad(db, user, nonce[:64])


@router.get("/ads/ssv", response_model=Ok, include_in_schema=False)
async def admob_ssv(request: Request, db: DB):
    """AdMob server-side verification callback. Only signed callbacks from Google grant rewards."""
    await monetization.handle_ssv(db, request.url.query)
    return Ok()
