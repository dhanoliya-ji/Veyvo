"""Anonymous crash and error reports from the mobile app.

No sign-in needed (the app may crash before or during sign-in), so nothing here identifies a person:
no user id, email, token or IP is accepted or stored. Reports are rate-limited per hashed IP, scrubbed
again on the server, logged as a structured warning and, when SENTRY_DSN is set, forwarded to Sentry.
"""

import re
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import AfterValidator, Field

from app.core import sentry
from app.core.logging import logger
from app.schemas.common import ApiModel, Ok, clean_text
from app.services.rate_limit import client_ip, hit

router = APIRouter(tags=["client-errors"])

# Anything that could identify someone or be a credential, in case it slipped into an error message.
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_JWT = re.compile(r"\beyJ[\w-]+\.[\w-]+\.[\w-]+")
_BEARER = re.compile(r"(?i)bearer\s+[\w.~+/=-]+")
_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)
_LONG_NUMBER = re.compile(r"\d{7,}")
_PATH = re.compile(r"(?:[A-Za-z]:)?(?:[\w.@%-]*[/\\])+([\w.@%-]+\.(?:js|jsx|ts|tsx|bundle|hbc|map))")


def scrub(value: str) -> str:
    value = _JWT.sub("[token]", value)
    value = _BEARER.sub("Bearer [token]", value)
    value = _EMAIL.sub("[email]", value)
    value = _UUID.sub("[id]", value)
    value = _LONG_NUMBER.sub("[number]", value)
    return _PATH.sub(r"\1", value)


def _clean_multiline(value: str) -> str:
    return scrub(value.replace("\x00", "").strip())


def _clean_line(value: str) -> str:
    return scrub(" ".join(clean_text(value).split()))


Line = Annotated[str, AfterValidator(_clean_line)]


class ClientErrorIn(ApiModel):
    message: Annotated[str, Field(min_length=1, max_length=500), AfterValidator(_clean_line)]
    stack: Annotated[str, Field(max_length=4000), AfterValidator(_clean_multiline)] | None = None
    is_fatal: bool = False
    source: Literal["global", "promise", "boundary", "manual"] = "global"
    app_version: Annotated[Line, Field(max_length=32)] = ""
    platform: Literal["android", "ios", "web", "windows", "macos"] = "android"
    os_version: Annotated[Line, Field(max_length=32)] = ""
    route: Annotated[Line, Field(max_length=200)] | None = None
    timestamp: datetime | None = None
    # A random id made on the device (reset on sign-out). Not linked to any account; only groups repeat crashes.
    install_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{8,64}$")] | None = None


@router.post("/client-errors", response_model=Ok, status_code=202)
async def report_client_error(body: ClientErrorIn, request: Request):
    await hit("client_error", client_ip(request))
    report = body.model_dump(mode="json")
    logger.warning(
        "client_error",
        extra={
            "error_message": report["message"],
            "stack_trace": report["stack"],
            "is_fatal": report["is_fatal"],
            "source": report["source"],
            "app_version": report["app_version"],
            "platform": report["platform"],
            "os_version": report["os_version"],
            "route": report["route"],
            "client_ts": report["timestamp"],
            "install_id": report["install_id"],
        },
    )
    sentry.capture_client_error(report)
    return Ok()
