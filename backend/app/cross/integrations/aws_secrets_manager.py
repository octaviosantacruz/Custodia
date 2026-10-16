"""Narrow AWS CLI adapter for retrieving one Secrets Manager string value.

The decrypted value is returned to the caller in memory.  This module never
logs command output because both stdout and stderr can contain sensitive
material or deployment details.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Callable
from typing import Any


class SecretRetrievalError(RuntimeError):
    """A sanitized failure while retrieving a secret."""


CommandRunner = Callable[..., subprocess.CompletedProcess[str]]


def get_secret_string(
    secret_id: str,
    region: str | None = None,
    *,
    runner: CommandRunner = subprocess.run,
) -> str:
    """Return the AWSCURRENT ``SecretString`` without printing its value."""
    normalized_secret_id = secret_id.strip()
    if not normalized_secret_id:
        raise SecretRetrievalError("DATABASE_SECRET_ID no puede estar vacío")

    command = [
        "aws",
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        normalized_secret_id,
    ]
    if region and region.strip():
        command.extend(["--region", region.strip()])
    command.extend(
        [
            "--output",
            "json",
            "--no-cli-pager",
            "--no-cli-auto-prompt",
        ]
    )

    try:
        result = runner(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
    except FileNotFoundError as exc:
        raise SecretRetrievalError(
            "AWS CLI no está instalado o no está disponible en PATH"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise SecretRetrievalError(
            "AWS Secrets Manager no respondió dentro del tiempo esperado"
        ) from exc
    except OSError as exc:
        raise SecretRetrievalError("No se pudo ejecutar AWS CLI") from exc

    if result.returncode != 0:
        # Do not append stderr: AWS errors can include account, role, secret
        # identifiers or other deployment details that don't belong in logs.
        raise SecretRetrievalError(
            "AWS CLI no pudo recuperar el secreto; verificá la sesión AWS, la región y los permisos IAM"
        )

    try:
        payload: Any = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError) as exc:
        raise SecretRetrievalError(
            "AWS CLI devolvió una respuesta que no cumple el contrato JSON esperado"
        ) from exc

    if not isinstance(payload, dict):
        raise SecretRetrievalError(
            "AWS CLI devolvió una respuesta que no cumple el contrato JSON esperado"
        )

    value = payload.get("SecretString")
    if not isinstance(value, str) or not value:
        raise SecretRetrievalError(
            "El secreto debe estar almacenado como SecretString; SecretBinary no está soportado"
        )
    return value
