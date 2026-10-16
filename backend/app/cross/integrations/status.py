"""Contract configuration status for the optional sources.

Reported without making external calls: only the presence of the approved
environment variables is inspected. The source list and its environment
contract live in `app.sources`, so a registered tool shows up here without
editing this module.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.sources import SourceSpec


def _source_status(spec: "SourceSpec") -> str:
    configured_values = sum(bool(os.getenv(name, '').strip()) for name in spec.status_required_env)
    secret_configured = bool(os.getenv(spec.status_secret_env or '', '').strip())
    secret_file = os.getenv(spec.status_secret_file_env or '', '').strip()
    if not secret_configured and secret_file:
        secret_configured = Path(secret_file).is_file()
    if configured_values == 0 and not secret_configured:
        return 'not_configured'
    if spec.status_required_env and configured_values == len(spec.status_required_env) and secret_configured:
        return 'configured'
    return 'partially_configured'


def get_integration_status() -> dict[str, str]:
    """Report approved contract configuration without making external calls."""
    # Resolve the composition registry when status is requested.
    from app.sources import OPTIONAL_SOURCES

    return {spec.source_system: _source_status(spec) for spec in OPTIONAL_SOURCES}
