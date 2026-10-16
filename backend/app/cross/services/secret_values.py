"""Read runtime secrets without exposing their values in configuration code."""

from __future__ import annotations

import os
from pathlib import Path


def secret_from_environment(name: str, file_name: str | None = None) -> str:
    """Read a secret from a file, falling back to an environment value.

    File-backed secrets are preferred so deployments can keep credentials out
    of environment dumps and ``.env`` files. The inline fallback preserves
    backwards compatibility while installations migrate to ``*_FILE``.
    Read failures are sanitized and never include the secret or file content.
    """
    inline_value = os.environ.get(name, "").strip()
    configured_file = os.environ.get(file_name, "").strip() if file_name else ""
    if configured_file:
        try:
            value = Path(configured_file).read_text(encoding="utf-8").strip()
        except FileNotFoundError as exc:
            # During migration, an existing inline value keeps the process
            # running until the operator creates the file-backed secret.
            if inline_value:
                return inline_value
            raise RuntimeError(f"No se pudo leer el secreto configurado en {file_name}") from exc
        except OSError as exc:
            raise RuntimeError(f"No se pudo leer el secreto configurado en {file_name}") from exc
        if value:
            return value

    return inline_value
