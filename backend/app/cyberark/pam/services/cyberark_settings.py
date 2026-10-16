from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from app.cyberark.pam.cyberark_errors import CyberArkError


@dataclass(frozen=True)
class CyberArkSettings:
    identity_url: str
    pvwa_url: str
    client_id: str
    client_secret: str
    request_timeout_seconds: float = 60.0
    connect_timeout_seconds: float = 15.0
    max_retries: int = 5

    def __post_init__(self) -> None:
        for name, value in (("CA_IDENTITY_URL", self.identity_url), ("CA_PVWA_URL", self.pvwa_url)):
            parsed = urlparse(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise CyberArkError(f"{name} debe ser una URL HTTPS válida")

    @classmethod
    def from_environment(cls) -> "CyberArkSettings":
        secret = os.getenv("CA_CLIENT_SECRET")
        if not secret:
            secret_path = Path(os.getenv("CA_SECRET_FILE", ".ca_secret"))
            if secret_path.exists():
                secret = secret_path.read_text(encoding="utf-8").strip()
        if not secret:
            raise CyberArkError("CA_CLIENT_SECRET o CA_SECRET_FILE es obligatorio")

        identity_url = os.getenv("CA_IDENTITY_URL")
        pvwa_url = os.getenv("CA_PVWA_URL")
        client_id = os.getenv("CA_CLIENT_ID")
        if not identity_url or not pvwa_url or not client_id:
            raise CyberArkError("CA_IDENTITY_URL, CA_PVWA_URL y CA_CLIENT_ID son obligatorios")
        return cls(
            identity_url=identity_url.rstrip("/"),
            pvwa_url=pvwa_url.rstrip("/"),
            client_id=client_id,
            client_secret=secret,
        )
