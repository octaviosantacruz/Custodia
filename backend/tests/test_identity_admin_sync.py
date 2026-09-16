import asyncio
import unittest
from dataclasses import dataclass
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.identity_admin_sync import sync_identity_admin_inventory


@dataclass
class _Settings:
    federations_path: str = ""


class _IdentityAdminClient:
    def __init__(self, federations=None):
        self._federations = federations or []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return None

    async def get_users(self, *, page_size):
        return [], 0

    async def get_roles(self, *, page_size):
        return [], 0

    async def get_federations(self):
        return self._federations


class IdentityAdminSyncTests(unittest.TestCase):
    def test_reconciles_only_identity_users_roles_and_memberships(self):
        client = _IdentityAdminClient()
        snapshot_sync = AsyncMock(return_value={"objects": 0, "relationships": 0, "retired_objects": 1, "retired_relationships": 1})

        with patch("app.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings()), \
             patch("app.identity_admin_sync.IdentityAdminClient", return_value=client), \
             patch("app.identity_admin_sync.map_identity_admin_objects", return_value=([], [])), \
             patch("app.identity_admin_sync.sync_inventory_snapshot", new=snapshot_sync):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))

        snapshot_sync.assert_awaited_once()
        self.assertEqual(snapshot_sync.await_args.kwargs["source_system"], "identity_administration")
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_object_types"], frozenset({"user", "role"}))
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_relationship_types"], frozenset({"user_has_role"}))

    def test_skips_federations_when_not_configured(self):
        client = _IdentityAdminClient(federations=[{"FederationUuid": "f1"}])
        client.get_federations = AsyncMock(side_effect=AssertionError("should not be called"))
        snapshot_sync = AsyncMock(return_value={"objects": 0, "relationships": 0, "retired_objects": 0, "retired_relationships": 0})

        with patch("app.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings(federations_path="")), \
             patch("app.identity_admin_sync.IdentityAdminClient", return_value=client), \
             patch("app.identity_admin_sync.map_identity_admin_objects", return_value=([], [])), \
             patch("app.identity_admin_sync.sync_inventory_snapshot", new=snapshot_sync):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))

        client.get_federations.assert_not_awaited()
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_object_types"], frozenset({"user", "role"}))

    def test_fetches_and_reconciles_federations_when_configured(self):
        client = _IdentityAdminClient(federations=[{
            "FederationUuid": "f1", "FederationName": "Okta", "FederationType": "SAML",
            "Active": True, "Role": "idp", "Usage": "sso",
        }])
        snapshot_sync = AsyncMock(return_value={"objects": 1, "relationships": 0, "retired_objects": 0, "retired_relationships": 0})

        with patch("app.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings(federations_path="/Federation/GetFederations")), \
             patch("app.identity_admin_sync.IdentityAdminClient", return_value=client), \
             patch("app.identity_admin_sync.map_identity_admin_objects", return_value=([], [])), \
             patch("app.identity_admin_sync.sync_inventory_snapshot", new=snapshot_sync):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))

        snapshot_sync.assert_awaited_once()
        objects = snapshot_sync.await_args.args[1]
        self.assertEqual(len(objects), 1)
        self.assertEqual(objects[0].object_type, "identity_federation")
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_object_types"], frozenset({"user", "role", "identity_federation"}))


if __name__ == "__main__":
    unittest.main()
