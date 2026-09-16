from typing import Annotated

from pydantic import BaseModel, StringConstraints, field_validator

from ...schemas import validate_email_format


class LocalLogin(BaseModel):
    # PENTEST-006: bounded before either field ever reaches verify_password
    # / hashlib.scrypt() -- the login path never calls validate_password()
    # (that only applies to *new* passwords), so this is the only guard
    # against an oversized credential on login specifically.
    email: Annotated[str, StringConstraints(max_length=320)]
    password: Annotated[str, StringConstraints(max_length=128)]

    # IF-001: a syntactically invalid string used to reach verify_password()
    # (and, before that fix, the rate limiter) unchanged -- letting an
    # unauthenticated caller mint an unbounded number of distinct rate-limit
    # buckets from garbage strings that could never match a real account.
    # Rejecting the format up front doesn't leak account existence (it
    # happens before any lookup, for well-formed and malformed emails
    # alike) and doesn't change the 401 for a well-formed-but-unknown email.
    _validate_email = field_validator("email")(validate_email_format)


class PasswordChange(BaseModel):
    current_password: Annotated[str, StringConstraints(max_length=128)]
    new_password: Annotated[str, StringConstraints(max_length=128)]


class ProfileUpdate(BaseModel):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]


class BootstrapRequest(LocalLogin):
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
