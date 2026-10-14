import httpx

from app.core.config import get_settings
from app.core.logging import logger

_SUBJECTS = {
    "verify_email": "Your Veyvo verification code",
    "reset_password": "Reset your Veyvo password",
}

_BODIES = {
    "verify_email": "Welcome to Veyvo! Your verification code is {code}. It expires in 30 minutes.",
    "reset_password": "Your Veyvo password reset code is {code}. It expires in 30 minutes. "
    "If you didn't ask for this, you can ignore this email — your password hasn't changed.",
}


async def send_code(email: str, purpose: str, code: str) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        if not settings.is_production:
            # Development fallback: the code goes to the server console (never in production).
            logger.info("dev_email_code", extra={"purpose": purpose, "dev_code_value": code})
        else:
            logger.error("email_not_configured", extra={"purpose": purpose})
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": settings.email_from,
                    "to": [email],
                    "subject": _SUBJECTS[purpose],
                    "text": _BODIES[purpose].format(code=code),
                },
            )
            resp.raise_for_status()
    except httpx.HTTPError:
        logger.exception("email_send_failed", extra={"purpose": purpose})
