"""Compatibility facade for catalog queries and mutations."""

from app.cyberark.pam.repositories.catalog_mutations import (
    create_business_unit,
    create_responsible,
    is_foreign_key_violation,
    is_unique_violation,
    update_business_unit,
    update_responsible,
)
from app.cyberark.pam.repositories.catalog_queries import get_catalogs

__all__ = [
    "create_business_unit",
    "create_responsible",
    "get_catalogs",
    "is_foreign_key_violation",
    "is_unique_violation",
    "update_business_unit",
    "update_responsible",
]
