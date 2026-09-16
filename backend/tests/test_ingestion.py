import asyncio
from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.ingestion import IngestionOptions, compare_inventory, run_ingestion, should_sync_pam


class IngestionComparisonTests(unittest.TestCase):
    def test_compares_new_changed_and_retired_rows(self):
        current_safes = [{
            "safe_number": 1, "safe_name": "SAFE-1", "safe_url_id": "SAFE-1",
            "location": "x", "creator_id": "u", "creator_name": "User",
            "olac_enabled": True, "number_of_versions_retention": 5,
            "number_of_days_retention": 7, "auto_purge_enabled": False,
            "creation_time": datetime.fromtimestamp(1_700_000_000, timezone.utc),
            "last_modification_time": datetime.fromtimestamp(1_700_000_001, timezone.utc),
            "description": "old", "managing_cpm": "CPM", "is_expired_member": False,
        }, {
            "safe_number": 2, "safe_name": "SAFE-2", "safe_url_id": "SAFE-2",
            "location": None, "creator_id": None, "creator_name": None,
            "olac_enabled": False, "number_of_versions_retention": None,
            "number_of_days_retention": None, "auto_purge_enabled": False,
            "creation_time": None, "last_modification_time": None,
            "description": None, "managing_cpm": None, "is_expired_member": False,
        }]
        current_members = [{
            "safe_number": 1, "member_id": "m-1", "member_name": "Old",
            "member_type": "User", "membership_expiration_date": None,
            "is_expired_membership_enable": False, "is_predefined_user": False,
            "is_read_only": False, "permissions": {"read": True},
        }, {
            "safe_number": 2, "member_id": "m-2", "member_name": "Retired",
            "member_type": "User", "membership_expiration_date": None,
            "is_expired_membership_enable": False, "is_predefined_user": False,
            "is_read_only": False, "permissions": {"read": True},
        }]
        incoming_safes = [{
            "safeNumber": 1, "safeName": "SAFE-1", "safeUrlId": "SAFE-1",
            "location": "x", "creator": {"id": "u", "name": "User"},
            "olacEnabled": True, "numberOfVersionsRetention": 5,
            "numberOfDaysRetention": 7, "autoPurgeEnabled": False,
            "creationTime": 1_700_000_000, "lastModificationTime": 1_700_000_001,
            "description": "new", "managingCPM": "CPM", "isExpiredMember": False,
        }, {
            "safeNumber": 3, "safeName": "SAFE-3", "safeUrlId": "SAFE-3",
            "location": None, "creator": {}, "olacEnabled": False,
            "numberOfVersionsRetention": None, "numberOfDaysRetention": None,
            "autoPurgeEnabled": False, "creationTime": None,
            "lastModificationTime": None, "description": None, "managingCPM": None,
            "isExpiredMember": False,
        }]
        incoming_members = [{
            "safeNumber": 1, "memberId": "m-1", "memberName": "New",
            "memberType": "User", "membershipExpirationDate": None,
            "isExpiredMembershipEnable": False, "isPredefinedUser": False,
            "isReadOnly": False, "permissions": {"read": True},
        }, {
            "safeNumber": 3, "memberId": "m-3", "memberName": "New member",
            "memberType": "User", "membershipExpirationDate": None,
            "isExpiredMembershipEnable": False, "isPredefinedUser": False,
            "isReadOnly": False, "permissions": {"read": True},
        }]

        result = compare_inventory(current_safes, current_members, incoming_safes, incoming_members)

        self.assertEqual(result["safe_counts"], {
            "incoming": 2, "current": 2, "new": 1, "changed": 1,
            "unchanged": 0, "retired": 1,
        })
        self.assertEqual(result["member_counts"], {
            "incoming": 2, "current": 2, "new": 1, "changed": 1,
            "unchanged": 0, "retired": 1,
        })
        self.assertEqual(result["samples"]["retired_safes"][0]["safe_name"], "SAFE-2")

    def test_changed_entries_carry_field_level_diffs(self):
        base_safe = {
            "safe_number": 1, "safe_name": "SAFE-1", "safe_url_id": "SAFE-1",
            "location": "x", "creator_id": "u", "creator_name": "User",
            "olac_enabled": True, "number_of_versions_retention": 5,
            "number_of_days_retention": 7, "auto_purge_enabled": False,
            "creation_time": datetime.fromtimestamp(1_700_000_000, timezone.utc),
            "last_modification_time": datetime.fromtimestamp(1_700_000_001, timezone.utc),
            "description": "old", "managing_cpm": "CPM", "is_expired_member": False,
        }
        incoming_safe = {
            "safeNumber": 1, "safeName": "SAFE-1", "safeUrlId": "SAFE-1",
            "location": "x", "creator": {"id": "u", "name": "User"},
            "olacEnabled": True, "numberOfVersionsRetention": 9,
            "numberOfDaysRetention": 7, "autoPurgeEnabled": False,
            "creationTime": 1_700_000_000, "lastModificationTime": 1_700_000_001,
            "description": "new", "managingCPM": "CPM", "isExpiredMember": False,
        }
        current_member = {
            "safe_number": 1, "member_id": "m-1", "member_name": "Person",
            "member_type": "User", "membership_expiration_date": None,
            "is_expired_membership_enable": False, "is_predefined_user": False,
            "is_read_only": False, "permissions": {"read": True, "manage": False},
        }
        incoming_member = {
            "safeNumber": 1, "memberId": "m-1", "memberName": "Person",
            "memberType": "User", "membershipExpirationDate": None,
            "isExpiredMembershipEnable": False, "isPredefinedUser": False,
            "isReadOnly": False, "permissions": {"read": True, "manage": True},
        }

        result = compare_inventory([base_safe], [current_member], [incoming_safe], [incoming_member])

        safe_changes = result["samples"]["changed_safes"][0]["changes"]
        changed_fields = {item["field"]: (item["before"], item["after"]) for item in safe_changes}
        self.assertEqual(changed_fields["Retención (versiones)"], (5, 9))
        self.assertEqual(changed_fields["Descripción"], ("old", "new"))
        self.assertNotIn("Nombre", changed_fields)

        member_entry = result["samples"]["changed_members"][0]
        self.assertTrue(member_entry["security_relevant"])
        self.assertIn(
            {"field": "Permiso · manage", "before": False, "after": True},
            member_entry["changes"],
        )

    def test_full_error_free_snapshot_is_eligible_for_pam_sync(self):
        self.assertTrue(should_sync_pam(IngestionOptions(max_safes=0), []))

    def test_limited_or_error_bearing_snapshot_is_not_eligible_for_pam_sync(self):
        self.assertFalse(should_sync_pam(IngestionOptions(max_safes=5), []))
        self.assertFalse(should_sync_pam(IngestionOptions(max_safes=0), [{"safeName": "SAFE-1", "error": "failed"}]))

    def test_normalizes_numeric_member_id_against_text_storage(self):
        safe = {
            "safe_number": 1, "safe_name": "SAFE-1", "safe_url_id": "SAFE-1",
            "location": None, "creator_id": None, "creator_name": None,
            "olac_enabled": False, "number_of_versions_retention": None,
            "number_of_days_retention": None, "auto_purge_enabled": False,
            "creation_time": None, "last_modification_time": None,
            "description": None, "managing_cpm": None, "is_expired_member": False,
        }
        member = {
            "safe_number": 1, "member_id": "123", "member_name": "Admin", "member_type": "User",
            "membership_expiration_date": None, "is_expired_membership_enable": False,
            "is_predefined_user": False, "is_read_only": False, "permissions": {"read": True},
        }
        incoming_safe = {**safe, "safeNumber": 1, "safeName": "SAFE-1", "safeUrlId": "SAFE-1", "creator": {}, "olacEnabled": False, "numberOfVersionsRetention": None, "numberOfDaysRetention": None, "autoPurgeEnabled": False, "creationTime": None, "lastModificationTime": None, "isExpiredMember": False}
        incoming_member = {**member, "safeNumber": 1, "memberId": 123, "memberName": "Admin", "memberType": "User", "membershipExpirationDate": None, "isExpiredMembershipEnable": False, "isPredefinedUser": False, "isReadOnly": False}
        result = compare_inventory([safe], [{**member, "member_id": "123"}], [incoming_safe], [incoming_member])
        self.assertEqual(result["member_counts"]["new"], 0)
        self.assertEqual(result["member_counts"]["retired"], 0)
        self.assertEqual(result["member_counts"]["unchanged"], 1)


class RunIngestionBreakdownTests(unittest.TestCase):
    def test_run_records_created_updated_retired_and_actor(self):
        safe = {"safeName": "S1", "safeNumber": 1}
        entry_results = [
            {"safe_inserted": True, "members_inserted": 2, "members_updated": 0, "member_count": 2},
            {"safe_inserted": False, "members_inserted": 0, "members_updated": 1, "member_count": 1},
        ]
        finished: dict = {}

        async def fake_finish(pool, run_id, status, safe_count, member_count, errors, breakdown=None):
            finished.update(status=status, safe_count=safe_count, breakdown=breakdown)

        created: dict = {}

        async def fake_create(pool, run_id, expected_safe_count=None, triggered_by=None):
            created["triggered_by"] = triggered_by

        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        with patch("app.ingestion.CyberArkSettings"), \
             patch("app.ingestion.CyberArkClient", return_value=client), \
             patch("app.ingestion.fetch_safes", new=AsyncMock(return_value=([safe, safe], 2))), \
             patch("app.ingestion.fetch_safe_members", new=AsyncMock(return_value=("S1", []))), \
             patch("app.ingestion.ingest_entry", new=AsyncMock(side_effect=entry_results)), \
             patch("app.ingestion.reconcile_inventory", new=AsyncMock(return_value=(3, 1))), \
             patch("app.ingestion.sync_pam_inventory", new=AsyncMock(return_value={})), \
             patch("app.ingestion.create_ingestion_run", new=fake_create), \
             patch("app.ingestion.update_ingestion_expected", new=AsyncMock()), \
             patch("app.ingestion.finish_ingestion_run", new=fake_finish), \
             patch("app.ingestion.refresh_findings", new=AsyncMock()):
            asyncio.run(run_ingestion(object(), IngestionOptions(reconcile_complete=True), uuid4(), triggered_by="op@example.com"))

        self.assertEqual(created["triggered_by"], "op@example.com")
        self.assertEqual(finished["status"], "completed")
        breakdown = finished["breakdown"]
        self.assertEqual(breakdown["safes_created"], 1)
        self.assertEqual(breakdown["safes_updated"], 1)
        self.assertEqual(breakdown["members_created"], 2)
        self.assertEqual(breakdown["members_updated"], 1)
        self.assertEqual(breakdown["safes_retired"], 1)
        self.assertEqual(breakdown["members_retired"], 3)
        self.assertTrue(breakdown["pam_synced"])


class SyncPamInventoryInvocationTests(unittest.TestCase):
    """PAM technical catalogs (platforms, PSM/connectors, component health,
    AIM) are refreshed by sync_pam_inventory, which run_ingestion must only
    call from a complete, error-free Safe snapshot (should_sync_pam)."""

    def _run(self, options, *, fetch_safes_return=None, ingest_entry_side_effect=None):
        safe = {"safeName": "S1", "safeNumber": 1}
        finished: dict = {}

        async def fake_finish(pool, run_id, status, safe_count, member_count, errors, breakdown=None):
            finished.update(status=status, breakdown=breakdown, errors=errors)

        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = False

        sync_pam_inventory_mock = AsyncMock(return_value={"objects": 1})
        with patch("app.ingestion.CyberArkSettings"), \
             patch("app.ingestion.CyberArkClient", return_value=client), \
             patch("app.ingestion.fetch_safes", new=AsyncMock(return_value=fetch_safes_return or ([safe], 1))), \
             patch("app.ingestion.fetch_safe_members", new=AsyncMock(return_value=("S1", []))), \
             patch("app.ingestion.ingest_entry", new=AsyncMock(
                 side_effect=ingest_entry_side_effect
                 or [{"safe_inserted": True, "members_inserted": 0, "members_updated": 0, "member_count": 0}],
             )), \
             patch("app.ingestion.reconcile_inventory", new=AsyncMock(return_value=(0, 0))), \
             patch("app.ingestion.sync_pam_inventory", new=sync_pam_inventory_mock), \
             patch("app.ingestion.create_ingestion_run", new=AsyncMock()), \
             patch("app.ingestion.update_ingestion_expected", new=AsyncMock()), \
             patch("app.ingestion.finish_ingestion_run", new=fake_finish), \
             patch("app.ingestion.refresh_findings", new=AsyncMock()):
            asyncio.run(run_ingestion(object(), options, uuid4(), triggered_by="op@example.com"))

        return sync_pam_inventory_mock, finished

    def test_calls_sync_pam_inventory_for_a_complete_error_free_snapshot(self):
        sync_pam_inventory_mock, finished = self._run(IngestionOptions(max_safes=0, reconcile_complete=True))

        sync_pam_inventory_mock.assert_awaited_once()
        self.assertTrue(finished["breakdown"]["pam_synced"])
        self.assertEqual(finished["errors"], [])

    def test_skips_sync_pam_inventory_when_the_snapshot_is_limited(self):
        sync_pam_inventory_mock, finished = self._run(IngestionOptions(max_safes=5, reconcile_complete=False))

        sync_pam_inventory_mock.assert_not_awaited()
        self.assertFalse(finished["breakdown"]["pam_synced"])

    def test_skips_sync_pam_inventory_when_a_safe_errors(self):
        sync_pam_inventory_mock, finished = self._run(
            IngestionOptions(max_safes=0, reconcile_complete=False),
            ingest_entry_side_effect=RuntimeError("boom"),
        )

        sync_pam_inventory_mock.assert_not_awaited()
        self.assertFalse(finished["breakdown"]["pam_synced"])
        self.assertTrue(finished["errors"])


if __name__ == "__main__":
    unittest.main()
