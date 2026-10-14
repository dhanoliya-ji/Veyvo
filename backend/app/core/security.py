import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

# Argon2id with library defaults (OWASP-recommended parameters).
_hasher = PasswordHasher()

# A real hash used to equalise timing when the account does not exist.
_DUMMY_HASH = _hasher.hash("veyvo-timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def create_access_token(user_id: uuid.UUID, role: str, session_id: uuid.UUID) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": str(user_id),
        "role": role,
        "sid": str(session_id),
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm), expires


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "exp", "iat", "sid"]},
    )
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """Refresh tokens and one-time codes are stored only as keyed hashes."""
    key = get_settings().jwt_secret_key.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def new_numeric_code(digits: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(digits))


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
