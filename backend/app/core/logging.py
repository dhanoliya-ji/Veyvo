import json
import logging
import sys
from datetime import UTC, datetime

# Keys that must never reach logs even if someone passes them in `extra`.
_REDACTED_KEYS = {"password", "token", "access_token", "refresh_token", "authorization", "content", "body", "code", "secret"}
_STD_ATTRS = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key in _STD_ATTRS or key.startswith("_"):
                continue
            payload[key] = "[redacted]" if key.lower() in _REDACTED_KEYS else value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Uvicorn's access log prints full URLs; keep it but our routes never put secrets in URLs.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


logger = logging.getLogger("veyvo")
