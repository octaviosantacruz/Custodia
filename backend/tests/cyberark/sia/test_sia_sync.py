"""Regression coverage for sync_sia_inventory's optional connectors/VM
catalogs: they must not be fetched or reconciled when their env-configured
path is unset, so an install that only ever synced policies keeps working
unchanged and never has previously-synced rows retired by a run that never
asked about them.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.cyberark.sia.integrations.sia import SiaSettings
from app.cyberark.sia.sia_sync import sync_sia_inventory


def _settings(connectors_path="", vm_infrastructure_path="", db_strong_accounts_path="", target_sets_path=""):
    return SiaSettings(
        base_url="https://sia.example", token_url="https://sia.example/oauth/token",
        client_id="client", client_secret="secret", policies_path="/api/access-policies",
        connectors_path=connectors_path, vm_infrastructure_path=vm_infrastructure_path,
        db_strong_accounts_path=db_strong_accounts_path, target_sets_path=target_sets_path,
    )


class SiaSyncOptionalCatalogsTests(unittest.TestCase):
    def test_skips_connectors_and_vms_when_not_configured(self):
        with patch("app.cyberark.sia.sia_sync.SiaSettings.from_environment", return_value=_settings()), \
             patch("app.cyberark.sia.sia_sync.SiaClient") as client_cls, \
             patch("app.cyberark.sia.sia_sync.sync_inventory_snapshot", new=AsyncMock(return_value={"objects": 0})) as sync_snapshot:
            client = client_cls.return_value.__aenter__.return_value
            client.get_policies = AsyncMock(return_value=[])
            client.get_policy_detail = AsyncMock()
            client.get_connectors = AsyncMock(return_value=[{"id": "should-not-be-fetched"}])
            client.get_virtual_machines = AsyncMock(return_value=[{"machineId": "should-not-be-fetched"}])
            client.get_database_strong_accounts = AsyncMock(return_value=[{"id": "should-not-be-fetched"}])
            client.get_target_sets = AsyncMock(return_value=[{"name": "should-not-be-fetched"}])

            asyncio.run(sync_sia_inventory(AsyncMock(), uuid4()))

            client.get_connectors.assert_not_awaited()
            client.get_virtual_machines.assert_not_awaited()
            client.get_database_strong_accounts.assert_not_awaited()
            client.get_target_sets.assert_not_awaited()
            reconcile_types = sync_snapshot.await_args.kwargs["reconcile_object_types"]
            self.assertEqual(reconcile_types, frozenset({"access_policy"}))

    def test_fetches_and_reconciles_connectors_and_vms_when_configured(self):
        settings = _settings(connectors_path="/api/connectors", vm_infrastructure_path="/api/infrastructure/virtual-machines")
        with patch("app.cyberark.sia.sia_sync.SiaSettings.from_environment", return_value=settings), \
             patch("app.cyberark.sia.sia_sync.SiaClient") as client_cls, \
             patch("app.cyberark.sia.sia_sync.sync_inventory_snapshot", new=AsyncMock(return_value={"objects": 3})) as sync_snapshot:
            client = client_cls.return_value.__aenter__.return_value
            client.get_policies = AsyncMock(return_value=[])
            client.get_policy_detail = AsyncMock()
            client.get_connectors = AsyncMock(return_value=[{"id": "c1"}])
            client.get_virtual_machines = AsyncMock(return_value=[{"machineId": "vm1"}])
            client.get_database_strong_accounts = AsyncMock(side_effect=AssertionError("should not be called"))
            client.get_target_sets = AsyncMock(side_effect=AssertionError("should not be called"))

            asyncio.run(sync_sia_inventory(AsyncMock(), uuid4()))

            client.get_connectors.assert_awaited_once()
            client.get_virtual_machines.assert_awaited_once()
            client.get_database_strong_accounts.assert_not_awaited()
            client.get_target_sets.assert_not_awaited()
            objects = sync_snapshot.await_args.args[1]
            object_types = {obj.object_type for obj in objects}
            self.assertIn("sia_connector", object_types)
            self.assertIn("sia_resource", object_types)
            reconcile_types = sync_snapshot.await_args.kwargs["reconcile_object_types"]
            self.assertEqual(reconcile_types, frozenset({"access_policy", "sia_connector", "sia_resource"}))

    def test_fetches_and_reconciles_database_strong_accounts_when_configured(self):
        settings = _settings(db_strong_accounts_path="/api/database-strong-accounts")
        with patch("app.cyberark.sia.sia_sync.SiaSettings.from_environment", return_value=settings), \
             patch("app.cyberark.sia.sia_sync.SiaClient") as client_cls, \
             patch("app.cyberark.sia.sia_sync.sync_inventory_snapshot", new=AsyncMock(return_value={"objects": 1})) as sync_snapshot:
            client = client_cls.return_value.__aenter__.return_value
            client.get_policies = AsyncMock(return_value=[])
            client.get_policy_detail = AsyncMock()
            client.get_connectors = AsyncMock(side_effect=AssertionError("should not be called"))
            client.get_virtual_machines = AsyncMock(side_effect=AssertionError("should not be called"))
            client.get_database_strong_accounts = AsyncMock(return_value=[{
                "id": "db1", "name": "db-account", "storeType": "mysql",
                "accountProperties": {"platform": "MySQL", "port": 3306, "database": "app", "address": "10.0.0.1", "username": "root"},
            }])
            client.get_target_sets = AsyncMock(side_effect=AssertionError("should not be called"))

            asyncio.run(sync_sia_inventory(AsyncMock(), uuid4()))

            client.get_database_strong_accounts.assert_awaited_once()
            client.get_target_sets.assert_not_awaited()
            client.get_connectors.assert_not_awaited()
            client.get_virtual_machines.assert_not_awaited()
            objects = sync_snapshot.await_args.args[1]
            db_objects = [obj for obj in objects if obj.object_type == "sia_database_account"]
            self.assertEqual(len(db_objects), 1)
            self.assertNotIn("address", db_objects[0].attributes)
            self.assertNotIn("username", db_objects[0].attributes)
            reconcile_types = sync_snapshot.await_args.kwargs["reconcile_object_types"]
            self.assertEqual(reconcile_types, frozenset({"access_policy", "sia_database_account"}))

    def test_fetches_and_reconciles_target_sets_only_when_configured(self):
        settings = _settings(target_sets_path="/api/targetsets")
        with patch("app.cyberark.sia.sia_sync.SiaSettings.from_environment", return_value=settings), \
             patch("app.cyberark.sia.sia_sync.SiaClient") as client_cls, \
             patch("app.cyberark.sia.sia_sync.sync_inventory_snapshot", new=AsyncMock(return_value={"objects": 1})) as sync_snapshot:
            client = client_cls.return_value.__aenter__.return_value
            client.get_policies = AsyncMock(return_value=[])
            client.get_policy_detail = AsyncMock()
            client.get_connectors = AsyncMock(side_effect=AssertionError("should not be called"))
            client.get_virtual_machines = AsyncMock(side_effect=AssertionError("should not be called"))
            client.get_database_strong_accounts = AsyncMock(side_effect=AssertionError("should not be called"))
            client.get_target_sets = AsyncMock(return_value=[{
                "name": "Target set", "secret_id": "secret", "entries": ["192.0.2.20"],
            }])

            asyncio.run(sync_sia_inventory(AsyncMock(), uuid4()))

            client.get_target_sets.assert_awaited_once()
            objects = sync_snapshot.await_args.args[1]
            target_objects = [obj for obj in objects if obj.object_type == "sia_target_set"]
            self.assertEqual(len(target_objects), 1)
            self.assertEqual(target_objects[0].attributes["certificate_validation"], None)
            self.assertNotIn("secret", str(target_objects[0].attributes))
            self.assertNotIn("192.0.2.20", str(target_objects[0].attributes))
            reconcile_types = sync_snapshot.await_args.kwargs["reconcile_object_types"]
            self.assertEqual(reconcile_types, frozenset({"access_policy", "sia_target_set"}))


if __name__ == "__main__":
    unittest.main()
