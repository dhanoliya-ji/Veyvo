"""Private media storage with short-lived signed URLs.

- `local` (development): files under MEDIA_DIR, served by `/media/{key}` only with a valid signature.
- `s3` (production): any S3-compatible bucket (AWS S3, Cloudflare R2, ...). The bucket stays private;
  clients get presigned GET URLs that expire.
Nothing is ever publicly listable, and every URL expires.
"""

import hashlib
import hmac
import time
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings

URL_TTL = 3600


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes | None: ...
    def delete(self, key: str) -> None: ...
    def url(self, key: str) -> str: ...


def _expiry() -> int:
    # Round up to the next hour so URLs stay identical for a while (lets the app cache images).
    now = int(time.time())
    return (now // URL_TTL + 2) * URL_TTL


def sign(key: str, exp: int) -> str:
    secret = get_settings().jwt_secret_key.encode()
    return hmac.new(secret, f"media:{key}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def valid_signature(key: str, exp: int, sig: str) -> bool:
    return exp > time.time() and hmac.compare_digest(sign(key, exp), sig)


class LocalStorage:
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("invalid key")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.is_file():
            path.unlink()

    def url(self, key: str) -> str:
        exp = _expiry()
        return f"{get_settings().public_base_url}/media/{key}?e={exp}&s={sign(key, exp)}"


class S3Storage:
    def __init__(self) -> None:
        import boto3

        s = get_settings()
        self.bucket = s.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint_url or None,
            aws_access_key_id=s.s3_access_key_id,
            aws_secret_access_key=s.s3_secret_access_key,
            region_name=s.s3_region or "auto",
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type, CacheControl="private, max-age=3600")

    def get(self, key: str) -> bytes | None:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.client.exceptions.NoSuchKey:
            return None

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def url(self, key: str) -> str:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=URL_TTL * 2)


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = S3Storage() if s.storage_backend == "s3" else LocalStorage(s.media_dir)
    return _storage


def reset_storage() -> None:
    global _storage
    _storage = None
