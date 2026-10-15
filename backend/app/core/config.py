from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, read from environment variables / .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "Veyvo"
    public_base_url: str = "http://localhost:8000"

    database_url: str = "sqlite+aiosqlite:///./veyvo_dev.db"
    redis_url: str = ""

    jwt_secret_key: str = "dev-only-change-me-dev-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    # Comma-separated in the environment (an empty value means none).
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Minimum age to hold an account. Veyvo is adults-only.
    minimum_age: int = 18

    # Expose one-time codes in API responses. Only honoured when app_env == "development".
    dev_expose_codes: bool = True

    # Email (Resend). When unset, codes are logged in development only.
    resend_api_key: str = ""
    email_from: str = "Veyvo <no-reply@veyvo.app>"

    # LiveKit media
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""

    # Expo push
    expo_push_access_token: str = ""

    # Media (profile photos, verification selfies). `local` for development, `s3` (S3/R2) in production.
    storage_backend: Literal["local", "s3"] = "local"
    media_dir: str = "./media"
    s3_bucket: str = ""
    s3_endpoint_url: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_region: str = ""
    max_photos: int = 6
    # Automatic image moderation. "none" = photos wait for a moderator (auto-approved only in development).
    moderation_provider: Literal["none", "sightengine"] = "none"
    sightengine_api_user: str = ""
    sightengine_api_secret: str = ""
    # Snapshot-based safety checks for cameras in public video rooms (needs LiveKit + S3 + a provider).
    live_video_moderation: bool = False
    live_video_snapshot_seconds: int = 10

    max_room_capacity: int = 50
    plus_room_capacity: int = 100

    # Rewarded ads (AdMob). Gems are granted only via AdMob server-side verification (SSV).
    admob_enabled: bool = False
    ad_reward_gems: int = 20
    ad_daily_reward_cap: int = 5

    # Google Play Billing. Purchases are verified with the Play Developer API using a service account.
    google_play_package: str = "app.veyvo"
    # Path to the service-account JSON file, or the JSON itself.
    google_play_service_account: str = ""
    # Shared secret appended to the Pub/Sub push URL for Real-time Developer Notifications.
    google_rtdn_token: str = ""
    max_message_length: int = 2000

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def expose_codes(self) -> bool:
        return self.app_env in ("development", "test") and self.dev_expose_codes

    @property
    def billing_configured(self) -> bool:
        return bool(self.google_play_service_account)

    @property
    def media_configured(self) -> bool:
        return bool(self.livekit_url and self.livekit_api_key and self.livekit_api_secret)

    def validate_for_production(self) -> None:
        if not self.is_production:
            return
        problems = []
        if self.jwt_secret_key.startswith("dev-only") or len(self.jwt_secret_key) < 32:
            problems.append("JWT_SECRET_KEY must be a random value of at least 32 characters")
        if self.database_url.startswith("sqlite"):
            problems.append("DATABASE_URL must point to PostgreSQL in production")
        if not self.redis_url:
            problems.append("REDIS_URL is required in production (multi-instance presence and rate limits)")
        if self.storage_backend != "s3":
            problems.append("STORAGE_BACKEND must be s3 in production (private bucket + signed URLs)")
        if not self.public_base_url.startswith("https://"):
            problems.append("PUBLIC_BASE_URL must use https in production")
        if problems:
            raise RuntimeError("Invalid production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
