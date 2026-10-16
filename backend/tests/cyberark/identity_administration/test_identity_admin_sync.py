import asyncio
import unittest
from dataclasses import dataclass
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.cyberark.identity_administration.identity_admin_sync import sync_identity_admin_inventory
from app.cyberark.identity_administration.integrations.identity_admin import IdentityAdminError


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
    def setUp(self):
        self.saved_stages = AsyncMock()
        patcher = patch("app.cyberark.identity_administration.identity_admin_sync.save_sync_stages", new=self.saved_stages)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_recovers_missing_user_once_and_maps_direct_membership(self):
        client = _IdentityAdminClient()
        client.get_roles = AsyncMock(return_value=([
            {"id": "r1", "displayName": "Admin", "members": [{"value": "service-id", "type": "User"}]},
            {"id": "r2", "displayName": "SCIM", "members": [{"value": "service-id", "type": "User"}]},
        ], 2))
        client.get_directory_user = AsyncMock(return_value={
            "id": "service-id", "userName": "apiuser@example.com",
            "urn:ietf:params:scim:schemas:cyberark:1.0:User": {"serviceUser": True, "oauthClient": True},
        })
        snapshot = AsyncMock(return_value={})
        with patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings()), patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient", return_value=client), patch("app.cyberark.identity_administration.identity_admin_sync.sync_inventory_snapshot", new=snapshot):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))
        objects, relationships = snapshot.await_args.args[1:3]
        users = [obj for obj in objects if obj.object_type == "user"]
        self.assertEqual(len(users), 1, "A user omitted by SCIM must appear in the inventory")
        self.assertTrue(users[0].attributes["service_user"])
        self.assertIsNone(users[0].attributes["active"])
        self.assertEqual({edge.target_id for edge in relationships if edge.relationship_type == "identity_member_of"}, {"r1", "r2"})
        self.assertEqual({edge.target_id for edge in relationships if edge.relationship_type == "user_has_role"}, {"r1", "r2"})
        client.get_directory_user.assert_awaited_once_with("service-id")

    def _run(self, client, snapshot, federations_path=""):
        with patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings(federations_path=federations_path)), patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient", return_value=client), patch("app.cyberark.identity_administration.identity_admin_sync.sync_inventory_snapshot", new=snapshot):
            return asyncio.run(sync_identity_admin_inventory(object(), uuid4()))

    def test_failed_directory_layer_degrades_run_without_retiring_users(self):
        client = _IdentityAdminClient()
        client.get_roles = AsyncMock(return_value=([{"id": "r1", "displayName": "Admin", "members": [{"value": "service-id", "type": "User"}]}], 1))
        client.get_directory_user = AsyncMock(side_effect=RuntimeError("directory unavailable"))
        snapshot = AsyncMock(return_value={})
        self._run(client, snapshot)
        kwargs = snapshot.await_args.kwargs
        self.assertEqual(kwargs["reconcile_object_types"], frozenset({"role"}))
        self.assertEqual(kwargs["reconcile_relationship_types"], frozenset())
        self.assertFalse(kwargs["retire_orphan_relationships"])
        outcomes = {item.stage: item for item in self.saved_stages.await_args.args[2]}
        self.assertEqual(outcomes["users"].status, "completed")
        self.assertEqual(outcomes["members_directory"].status, "failed")
        self.assertEqual(outcomes["members_directory"].error_kind, "RuntimeError")
        self.assertFalse(outcomes["members_directory"].required)

    def test_failed_required_layer_aborts_before_writing_and_still_records_stages(self):
        client = _IdentityAdminClient()
        client.get_users = AsyncMock(side_effect=RuntimeError("users down"))
        snapshot = AsyncMock()
        with self.assertRaisesRegex(RuntimeError, "users down"):
            self._run(client, snapshot)
        snapshot.assert_not_awaited()
        outcomes = self.saved_stages.await_args.args[2]
        self.assertEqual([(item.stage, item.status) for item in outcomes], [("users", "failed")])

    def test_failed_federations_layer_keeps_users_and_roles_reconciling(self):
        client = _IdentityAdminClient()
        client.get_federations = AsyncMock(side_effect=RuntimeError("federations down"))
        snapshot = AsyncMock(return_value={})
        self._run(client, snapshot, federations_path="/Federation/GetFederations")
        kwargs = snapshot.await_args.kwargs
        self.assertEqual(kwargs["reconcile_object_types"], frozenset({"user", "role"}))
        self.assertEqual(kwargs["reconcile_relationship_types"], frozenset({"user_has_role", "identity_member_of"}))
        self.assertTrue(kwargs["retire_orphan_relationships"])
        self.assertEqual(self.saved_stages.await_args.args[2][-1].status, "failed")

    def test_omitted_members_is_a_complete_empty_scim_membership(self):
        client = _IdentityAdminClient()
        client.get_roles = AsyncMock(return_value=([{"id": "r1", "displayName": "Admin"}], 1))
        snapshot = AsyncMock(return_value={})
        with patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings()), patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient", return_value=client), patch("app.cyberark.identity_administration.identity_admin_sync.sync_inventory_snapshot", new=snapshot):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))
        snapshot.assert_awaited_once()
        objects, relationships = snapshot.await_args.args[1:3]
        role = next(obj for obj in objects if obj.object_type == "role")
        self.assertEqual(role.attributes["membership_status"], "complete")
        self.assertEqual(role.attributes["direct_member_count"], 0)
        self.assertEqual(relationships, [])

    def test_invalid_membership_shape_aborts_before_reconciliation(self):
        client = _IdentityAdminClient()
        client.get_roles = AsyncMock(return_value=([{"id": "r1", "displayName": "Admin", "members": None}], 1))
        snapshot = AsyncMock()
        with patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings()), patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient", return_value=client), patch("app.cyberark.identity_administration.identity_admin_sync.sync_inventory_snapshot", new=snapshot):
            with self.assertRaises(IdentityAdminError):
                asyncio.run(sync_identity_admin_inventory(object(), uuid4()))
        snapshot.assert_not_awaited()

    def test_reconciles_only_identity_users_roles_and_memberships(self):
        client = _IdentityAdminClient()
        snapshot_sync = AsyncMock(return_value={"objects": 0, "relationships": 0, "retired_objects": 1, "retired_relationships": 1})

        with patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings()), \
             patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient", return_value=client), \
             patch("app.cyberark.identity_administration.identity_admin_sync.map_identity_admin_objects", return_value=([], [])), \
             patch("app.cyberark.identity_administration.identity_admin_sync.sync_inventory_snapshot", new=snapshot_sync):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))

        snapshot_sync.assert_awaited_once()
        self.assertEqual(snapshot_sync.await_args.kwargs["source_system"], "identity_administration")
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_object_types"], frozenset({"user", "role"}))
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_relationship_types"], frozenset({"user_has_role", "identity_member_of"}))

    def test_skips_federations_when_not_configured(self):
        client = _IdentityAdminClient(federations=[{"FederationUuid": "f1"}])
        client.get_federations = AsyncMock(side_effect=AssertionError("should not be called"))
        snapshot_sync = AsyncMock(return_value={"objects": 0, "relationships": 0, "retired_objects": 0, "retired_relationships": 0})

        with patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings(federations_path="")), \
             patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient", return_value=client), \
             patch("app.cyberark.identity_administration.identity_admin_sync.map_identity_admin_objects", return_value=([], [])), \
             patch("app.cyberark.identity_administration.identity_admin_sync.sync_inventory_snapshot", new=snapshot_sync):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))

        client.get_federations.assert_not_awaited()
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_object_types"], frozenset({"user", "role"}))

    def test_fetches_and_reconciles_federations_when_configured(self):
        client = _IdentityAdminClient(federations=[{
            "FederationUuid": "f1", "FederationName": "Okta", "FederationType": "SAML",
            "Active": True, "Role": "idp", "Usage": "sso",
        }])
        snapshot_sync = AsyncMock(return_value={"objects": 1, "relationships": 0, "retired_objects": 0, "retired_relationships": 0})

        with patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminSettings.from_environment", return_value=_Settings(federations_path="/Federation/GetFederations")), \
             patch("app.cyberark.identity_administration.identity_admin_sync.IdentityAdminClient", return_value=client), \
             patch("app.cyberark.identity_administration.identity_admin_sync.map_identity_admin_objects", return_value=([], [])), \
             patch("app.cyberark.identity_administration.identity_admin_sync.sync_inventory_snapshot", new=snapshot_sync):
            asyncio.run(sync_identity_admin_inventory(object(), uuid4()))

        snapshot_sync.assert_awaited_once()
        objects = snapshot_sync.await_args.args[1]
        self.assertEqual(len(objects), 1)
        self.assertEqual(objects[0].object_type, "identity_federation")
        self.assertEqual(snapshot_sync.await_args.kwargs["reconcile_object_types"], frozenset({"user", "role", "identity_federation"}))


if __name__ == "__main__":
    unittest.main()
