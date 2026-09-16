"""Compatibility facade for Safe repositories.

The query implementations live in focused modules. This facade preserves the
original import path used by routes and tests while callers migrate gradually.
"""

from .account_queries import get_safe_accounts, list_accounts
from .safe_mutations import (
    count_retired_candidates,
    get_retired_candidates,
    list_safe_audit,
    update_safe_assignment,
    update_safe_metadata,
    update_safe_quick,
    update_safe_scope,
    update_safe_account_type,
)
from .safe_queries import _safe_filters, export_safes, get_safe_detail, list_safes

__all__ = [
    "_safe_filters",
    "count_retired_candidates",
    "export_safes",
    "get_retired_candidates",
    "get_safe_accounts",
    "get_safe_detail",
    "list_accounts",
    "list_safe_audit",
    "list_safes",
    "update_safe_assignment",
    "update_safe_metadata",
    "update_safe_quick",
    "update_safe_scope",
    "update_safe_account_type",
]
