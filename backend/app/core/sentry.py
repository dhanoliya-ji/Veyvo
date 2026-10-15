"""Optional error reporting to Sentry.

Off unless SENTRY_DSN is set. Personal data never leaves the server: no user ids, emails, IP addresses,
cookies, Authorization headers or request bodies (which may contain passwords or messages).
"""

from typing import Any

from app.core.config import get_settings
from app.core.logging import logger

# Headers that identify a person or carry credentials. Everything else (user agent, content type) is kept.
_DROP_HEADERS = {"authorization", "cookie", "set-cookie", "x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip"}

_enabled = False


def scrub_event(event: dict[str, Any], _hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sentry `before_send`: strip request bodies, cookies, credentials and IPs from every event."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        request.pop("env", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {k: v for k, v in headers.items() if k.lower() not in _DROP_HEADERS}
    # Never attach a person to an event.
    event.pop("user", None)
    return event


def init_sentry() -> bool:
    """Start the Sentry SDK for this server when SENTRY_DSN is set. Safe to call more than once."""
    global _enabled
    settings = get_settings()
    if _enabled or not settings.sentry_dsn:
        return _enabled
    try:
        import sentry_sdk
    except ImportError:  # pragma: no cover - sentry-sdk is in requirements.txt
        logger.warning("sentry_sdk_missing")
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=scrub_event,
        max_request_body_size="never",
    )
    _enabled = True
    return True


def capture_client_error(report: dict[str, Any]) -> None:
    """Forward an anonymous app crash report (already validated and scrubbed) to Sentry, if enabled."""
    if not _enabled:
        return
    import sentry_sdk

    with sentry_sdk.new_scope() as scope:
        scope.set_level("fatal" if report.get("is_fatal") else "error")
        scope.set_tag("origin", "mobile")
        for key in ("platform", "os_version", "app_version", "route", "source"):
            if report.get(key):
                scope.set_tag(key, report[key])
        if report.get("install_id"):
            # Random id made on the device (not tied to an account), used only to group repeat crashes.
            scope.set_tag("install_id", report["install_id"])
        scope.set_context("client_error", {"stack": report.get("stack"), "timestamp": report.get("timestamp")})
        scope.fingerprint = ["client-error", report.get("platform") or "", report.get("message") or ""]
        sentry_sdk.capture_message(f"[app] {report.get('message')}")
