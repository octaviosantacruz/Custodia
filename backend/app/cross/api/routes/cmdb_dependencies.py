"""Catalog read dependencies shared by the per-source CMDB route modules."""

from fastapi import Depends

from app.auth import require_any_permission_read

# PAM technical catalogs (platforms/connectors/components/access-assets) used to require
# access:manage -- the same permission as full user/role administration. These now also accept
# the narrower pam:catalogs_read, so PAM operator/admin roles can see PAM's own catalogs without
# needing user-admin rights. access:manage keeps working unchanged (see migration 044).
# PENTEST-005: these are read-only catalogs; the *_read variants never accept X-Access-Token
# (the automation token is for writes only, not for browsing admin/PAM/SIA catalogs).
PAM_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "pam:catalogs_read"))]
# Access space is a CyberArk tool served under the PAM catalog permission.
ACCESS_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "pam:catalogs_read"))]
SIA_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "sia:catalogs_read"))]
IDENTITY_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "identity:catalogs_read"))]
NETSKOPE_CATALOG_DEPENDENCIES = [Depends(require_any_permission_read("access:manage", "netskope:read"))]
