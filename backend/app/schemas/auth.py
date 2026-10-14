from datetime import date

from pydantic import EmailStr, Field, field_validator

from app.schemas.common import ApiModel

_COMMON_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty123",
    "qwertyuiop",
    "iloveyou",
    "11111111",
    "abc12345",
    "letmein1",
    "welcome1",
    "admin123",
}


def _check_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Use at least 8 characters.")
    if len(value) > 128:
        raise ValueError("Use at most 128 characters.")
    if value.lower() in _COMMON_PASSWORDS:
        raise ValueError("That password is too common. Try something less predictable.")
    if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
        raise ValueError("Include at least one letter and one number.")
    return value


class RegisterIn(ApiModel):
    email: EmailStr
    password: str
    # Used only to confirm the person is an adult. It is NOT stored.
    birth_date: date
    accept_terms: bool

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password(v)

    @field_validator("accept_terms")
    @classmethod
    def _terms(cls, v: bool) -> bool:
        if not v:
            raise ValueError("You need to accept the Terms and Community Guidelines.")
        return v


class LoginIn(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    platform: str | None = Field(default=None, max_length=20)


class RefreshIn(ApiModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class TokenPair(ApiModel):
    access_token: str
    refresh_token: str
    access_expires_at: str
    token_type: str = "bearer"


class AuthResponse(TokenPair):
    user_id: str
    email_verified: bool
    onboarded: bool
    dev_code: str | None = None


class VerifyEmailIn(ApiModel):
    code: str = Field(pattern=r"^\d{6}$")


class ForgotPasswordIn(ApiModel):
    email: EmailStr


class ResetPasswordIn(ApiModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password(v)


class ChangePasswordIn(ApiModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password(v)


class DeleteAccountIn(ApiModel):
    password: str = Field(min_length=1, max_length=128)
    confirm: str

    @field_validator("confirm")
    @classmethod
    def _confirm(cls, v: str) -> str:
        if v.strip().upper() != "DELETE":
            raise ValueError("Type DELETE to confirm.")
        return v


class CodeSent(ApiModel):
    ok: bool = True
    dev_code: str | None = None
