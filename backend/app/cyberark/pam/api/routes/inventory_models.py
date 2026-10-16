"""Stable response contracts for inventory mutations.

The mutation repositories return PostgreSQL rows with more columns than the
browser needs.  These models keep the public response explicit and prevent a
future schema column (or an internal account attribute) from silently becoming
part of the HTTP contract.
"""

from datetime import datetime
from pydantic import BaseModel, ConfigDict


class InventoryMutationModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class SafeMutationResponse(InventoryMutationModel):
    safe_number: int | None = None
    internal_name: str | None = None
    business_unit_id: int | None = None
    responsible_id: int | None = None
    classification_status: str | None = None
    inventory_scope: str | None = None
    data_quality_status: str | None = None
    workflow_status: str | None = None
    next_action: str | None = None
    account_type_classification: str | None = None
    notes: str | None = None
    assigned_at: datetime | None = None
    assigned_by: str | None = None
    updated_at: datetime | None = None


class AccountClassificationResponse(InventoryMutationModel):
    safe_number: int
    account_id: str
    account_name: str
    user_name: str | None = None
    address: str | None = None
    platform_id: str | None = None
    platform_name: str | None = None
    lifecycle_status: str
    last_seen_at: datetime | None = None
    inventory_account_type: str | None = None


class BulkAssignmentResponse(InventoryMutationModel):
    updated: int
    updated_safe_numbers: list[int]
    missing_safe_numbers: list[int]


class UpdatedResponse(InventoryMutationModel):
    updated: bool = True
