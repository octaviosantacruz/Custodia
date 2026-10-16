"""Shared response schemas for the verified PAM chain traversal.

`build_pam_chain` (`repositories/pam_chain_queries.py`) is the single
traversal used by both `/api/cmdb/pam-users/{id}/chain` and the sanctioned
Identity bridge, so the nested roles -> Safes -> platforms -> PSM shape lives
here once. The bridge adds `match_basis`/`status` on top
(`cmdb_identity_models.IdentityPamChainResponse`); the plain PAM route
publishes only the traversal result.
"""

from pydantic import BaseModel, ConfigDict


class PamChainObjectRef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    source_id: str


class PamChainPlatform(PamChainObjectRef):
    psms: list[PamChainObjectRef]


class PamChainSafe(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_id: int
    display_name: str
    safe_number: str
    account_count: int
    platform_count: int
    platforms: list[PamChainPlatform]


class PamChainRole(PamChainObjectRef):
    safe_count: int
    safes: list[PamChainSafe]


class PamChainTotals(BaseModel):
    model_config = ConfigDict(extra="ignore")

    roles: int
    safes: int
    platforms: int
    psms: int
    accounts: int
