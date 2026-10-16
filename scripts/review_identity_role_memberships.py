#!/usr/bin/env python3
"""Read-only Identity review. Prints role names/counts, never account IDs or tokens."""
import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.cyberark.identity_administration.integrations.identity_admin import IdentityAdminClient, IdentityAdminSettings  # noqa: E402
from app.cyberark.identity_administration.services.identity_admin_mapping import map_identity_admin_objects  # noqa: E402
from app.cyberark.identity_administration.services.role_membership_review import review_role_memberships  # noqa: E402


async def main():
    load_dotenv(ROOT / ".env.local")
    async with IdentityAdminClient(IdentityAdminSettings.from_environment()) as client:
        users, _ = await client.get_users()
        roles, _ = await client.get_roles()
    objects, relationships = map_identity_admin_objects(users, roles)
    result = review_role_memberships(objects, relationships)
    result["scope"] = "Coincidencias de membresía; no prueban permisos duplicados ni autorizan retirar roles. Las cuentas referenciadas pueden no tener ficha en Users."
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"No se pudo completar la revisión: {type(exc).__name__}", file=sys.stderr)
        sys.exit(1)
