import re
import uuid
from datetime import datetime
from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

T = TypeVar("T")

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_ZERO_WIDTH = re.compile(r"[​-‏‪-‮⁦-⁩﻿]")


def clean_text(value: str) -> str:
    """Strip control and bidi-override characters (used for spoofing) and trim whitespace."""
    value = _CONTROL_CHARS.sub("", value)
    value = _ZERO_WIDTH.sub("", value)
    return value.strip()


def like_pattern(term: str, *, prefix: bool = False) -> str:
    """Escape LIKE wildcards in user input. Use with `.ilike(pattern, escape="\\")`."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%" if prefix else f"%{escaped}%"


def _single_line(value: str) -> str:
    return " ".join(clean_text(value).split())


CleanText = Annotated[str, AfterValidator(clean_text)]
SingleLine = Annotated[str, AfterValidator(_single_line)]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(ApiModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None


class Ok(ApiModel):
    ok: bool = True


class UserSummary(ApiModel):
    id: uuid.UUID
    username: str | None
    display_name: str
    avatar: dict
    level: int = 1
    vibe: str | None = None


class TimestampedId(ApiModel):
    id: uuid.UUID
    created_at: datetime


Limit = Annotated[int, Field(ge=1, le=100)]
