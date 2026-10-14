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

    max_room_capacity: int = 50
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
        if not self.public_base_url.startswith("https://"):
            problems.append("PUBLIC_BASE_URL must use https in production")
        if problems:
            raise RuntimeError("Invalid production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()
