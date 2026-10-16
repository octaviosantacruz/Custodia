import re

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def validate_email_format(value: str) -> str:
    """Shared email format check for user-facing account emails (login accounts)."""
    normalized = value.strip()
    if not EMAIL_PATTERN.match(normalized):
        raise ValueError("Ingresá un email válido")
    return normalized


