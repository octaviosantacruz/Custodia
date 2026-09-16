import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.cyberark import CyberArkError
from app.pam_inventory import (
    get_group_details,
    map_pam_access_relationships,
    map_pam_objects,
    reconcilable_pam_object_types,
    reconcilable_pam_relationship_types,
    sync_pam_connectors_inventory,
    sync_pam_inventory,
)
from app.services.pam_source import PamSourceSnapshot, get_platform_details


class PamInventoryMappingTests(unittest.TestCase):
    def test_maps_users_groups_platforms_and_psm_relationships(self):
        objects, relationships = map_pam_objects(
            users=[{"UUID": "user-1", "username": "user", "id": "1", "userType": "EPVUser", "source": "CyberArk", "componentUser": False}],
            groups=[{"id": "group-1", "groupName": "Vault Admins", "groupType": "Vault", "location": "\\"}],
            platforms=[{
                "general": {"id": "WinDomain", "name": "Windows Domain", "active": True, "platformBaseID": "Win", "platformType": "group", "systemType": "Windows"},
                "sessionManagement": {"PSMServerID": "PSM-01"},
            }],
            platform_details={"WinDomain": {"allowed_safes_pattern": "^Windows-"}},
        )
        self.assertEqual([(item.object_type, item.source_id) for item in objects], [
            ("user", "user-1"), ("role", "group-1"), ("platform", "WinDomain"), ("psm", "PSM-01"),
        ])
        self.assertEqual(relationships[0].relationship_type, "platform_uses_psm")
        self.assertEqual(objects[2].attributes["allowed_safes_pattern"], "^Windows-")

    def test_keeps_only_allowed_safes_from_platform_detail(self):
        class Client:
            async def get_platform_detail(self, platform_id):
                return {
                    "PlatformID": platform_id,
                    "Details": {
                        "AllowedSafes": "^Windows-",
                        "PasswordLength": 32,
                        "NFOnPasswordUsedRecipients": "not-allowed",
                    },
                }

        result = asyncio.run(get_platform_details(
            Client(),
            [{"general": {"id": "WinDomain"}}],
        ))

        self.assertEqual(result, {"WinDomain": {"allowed_safes_pattern": "^Windows-"}})

    def test_treats_missing_allowed_safes_as_no_pattern(self):
        """CyberArk omits AllowedSafes (null) for some platforms regardless of
        active status; that's "no documented pattern", not a broken contract."""
        class Client:
            async def get_platform_detail(self, platform_id):
                return {"PlatformID": platform_id, "Details": {"AllowedSafes": None}}

        result = asyncio.run(get_platform_details(Client(), [{"general": {"id": "PSMSecureConnect"}}]))
        self.assertEqual(result["PSMSecureConnect"]["allowed_safes_pattern"], "")

    def test_rejects_allowed_safes_with_unexpected_type(self):
        class Client:
            async def get_platform_detail(self, platform_id):
                return {"PlatformID": platform_id, "Details": {"AllowedSafes": 42}}

        with self.assertRaises(CyberArkError):
            asyncio.run(get_platform_details(Client(), [{"general": {"id": "Weird"}}]))

    def test_uses_username_when_api_omits_uuid(self):
        objects, _ = map_pam_objects(users=[{"username": "service-user"}], groups=[], platforms=[])
        self.assertEqual(objects[0].source_id, "service-user")
        self.assertEqual(objects[0].attributes["identity_key"], "username")

    def test_normalizes_numeric_group_id(self):
        objects, _ = map_pam_objects(users=[], groups=[{"id": 42, "groupName": "Operators"}], platforms=[])
        self.assertEqual(objects[0].source_id, "42")

    def test_uses_platform_id_when_name_is_missing(self):
        objects, _ = map_pam_objects(users=[], groups=[], platforms=[{"general": {"id": "platform-1"}}])
        self.assertEqual(objects[0].display_name, "platform-1")

    def test_reconciles_only_relationship_types_with_complete_mapping(self):
        types = reconcilable_pam_relationship_types(
            skipped_accounts=23,
            skipped_group_members=7,
            skipped_safe_group_memberships=0,
        )
        self.assertEqual(types, frozenset({"platform_uses_psm", "role_grants_access"}))

    def test_reconciles_all_relationship_types_without_gaps(self):
        types = reconcilable_pam_relationship_types(
            skipped_accounts=0,
            skipped_group_members=0,
            skipped_safe_group_memberships=0,
        )
        self.assertEqual(types, frozenset({"platform_uses_psm", "role_grants_access", "safe_uses_platform", "user_has_role"}))

    def test_reconciles_empty_pam_collections_too(self):
        """A complete source can legitimately return zero objects of one type."""
        self.assertEqual(
            reconcilable_pam_object_types(),
            frozenset({
                "user", "role", "platform", "psm",
                "component", "psm_connector", "aim_application",
                "platform_dependent", "platform_group", "platform_rotational_group", "platform_target",
            }),
        )

    def test_snapshot_reconciliation_keeps_empty_object_types_in_scope(self):
        async def exercise():
            with patch("app.pam_inventory.fetch_pam_source", new=AsyncMock(return_value=PamSourceSnapshot([], [], [], [], []))), \
                 patch("app.pam_inventory.fetch_all", new=AsyncMock(side_effect=[[], []])), \
                 patch("app.pam_inventory.map_pam_objects", return_value=([], [])), \
                 patch("app.pam_inventory.map_pam_access_relationships", return_value=([], 0, 0)), \
                 patch("app.pam_inventory.sync_accounts", new=AsyncMock(return_value={"accounts": 0, "skipped_accounts": 0, "retired_accounts": 0})), \
                 patch("app.pam_inventory.sync_inventory_snapshot", new=AsyncMock(return_value={"objects": 0, "relationships": 0, "retired_objects": 4, "retired_relationships": 0})) as sync_snapshot:
                result = await sync_pam_inventory(object(), uuid4())
            return result, sync_snapshot

        result, sync_snapshot = asyncio.run(exercise())
        self.assertEqual(result["retired_objects"], 4)
        self.assertEqual(sync_snapshot.await_args.kwargs["reconcile_object_types"], reconcilable_pam_object_types())

    def test_rejects_invalid_group_detail_concurrency(self):
        with self.assertRaises(ValueError):
            asyncio.run(get_group_details(None, [], max_concurrency=0))

    def test_maps_verified_group_and_safe_memberships(self):
        relationships, skipped_users, skipped_safe_groups = map_pam_access_relationships(
            users=[{"UUID": "user-1", "username": "operator"}],
            groups=[{"id": 42, "groupName": "Operators"}],
            group_details=[{"members": [{"id": 1, "username": "operator"}, {"id": 2, "username": "outside-user"}]}],
            safe_group_memberships=[{"safe_number": 7, "member_name": "Operators"}, {"safe_number": 8, "member_name": "unknown"}],
        )
        self.assertEqual([(item.relationship_type, item.source_id, item.target_id) for item in relationships], [
            ("user_has_role", "user-1", "42"),
            ("role_grants_access", "42", "7"),
        ])
        self.assertEqual(skipped_users, 1)
        self.assertEqual(skipped_safe_groups, 1)

    def test_rejects_user_without_uuid_or_username(self):
        with self.assertRaises(CyberArkError):
            map_pam_objects(users=[{}], groups=[], platforms=[])

    def test_user_extended_details_excludes_personal_details(self):
        objects, _ = map_pam_objects(users=[{
            "UUID": "user-1", "username": "user",
            "enableUser": True, "suspended": False,
            "vaultAuthorization": ["AddSafes", "AuditUsers"],
            "groupsMembership": ["Vault Admins"],
            "location": "\\",
            "personalDetails": {"email": "user@example.com", "phone": "+1-555-0100"},
        }], groups=[], platforms=[])
        attributes = objects[0].attributes
        self.assertEqual(attributes["enabled"], True)
        self.assertEqual(attributes["suspended"], False)
        self.assertEqual(attributes["vault_authorization"], ["AddSafes", "AuditUsers"])
        self.assertEqual(attributes["groups_membership"], ["Vault Admins"])
        self.assertNotIn("personal_details", attributes)
        self.assertNotIn("personalDetails", attributes)
        self.assertNotIn("email", str(attributes))

    def test_platform_targets_map_as_their_own_object_type(self):
        """PLAT-002 uses its own numeric ID/Name space, not the platform's own
        PlatformID -- it must never be merged onto the `platform` object."""
        objects, _ = map_pam_objects(
            users=[], groups=[],
            platforms=[{"general": {"id": "WinDomain", "name": "Windows Domain"}}],
            platform_targets=[{
                "ID": 37, "Name": "UENO_WIN_DOM_PROD_30", "PlatformBaseID": "WinDomain",
                "CredentialsManagementPolicy": {
                    "Change": {"PerformAutomatic": True, "RequirePasswordEveryXDays": 90},
                    "Verification": {"PerformAutomatic": False, "RequirePasswordEveryXDays": 7},
                    "Reconcile": {"AutomaticReconcileWhenUnsynced": True},
                },
                "PrivilegedSessionManagement": {"PSMServerId": "PSMServer_01", "PSMServerName": "psm01"},
                "PrivilegedAccessWorkflows": {
                    "RequireDualControlPasswordAccessApproval": True,
                    "EnforceOnetimePasswordAccess": False,
                    "RequireUsersToSpecifyReasonForAccess": True,
                    "EnforceCheckinCheckoutExclusiveAccess": False,
                },
            }],
        )
        platform_object = next(item for item in objects if item.object_type == "platform")
        target_object = next(item for item in objects if item.object_type == "platform_target")
        self.assertNotIn("dual_control_required", platform_object.attributes)
        self.assertNotIn("psm_server_id", platform_object.attributes)
        self.assertEqual(target_object.source_id, "37")
        self.assertEqual(target_object.display_name, "UENO_WIN_DOM_PROD_30")
        self.assertEqual(target_object.attributes["platform_base_id"], "WinDomain")
        self.assertEqual(target_object.attributes["credentials_change_automatic"], True)
        self.assertEqual(target_object.attributes["credentials_change_interval_days"], 90)
        self.assertEqual(target_object.attributes["credentials_verify_automatic"], False)
        self.assertEqual(target_object.attributes["credentials_reconcile_automatic"], True)
        self.assertEqual(target_object.attributes["psm_server_id"], "PSMServer_01")
        self.assertEqual(target_object.attributes["dual_control_required"], True)
        self.assertEqual(target_object.attributes["reason_required"], True)
        self.assertEqual(target_object.attributes["otp_required"], False)

    def test_psm_server_catalog_is_authoritative_and_platform_fallback_still_links(self):
        objects, relationships = map_pam_objects(
            users=[], groups=[],
            platforms=[{"general": {"id": "P1"}, "sessionManagement": {"PSMServerID": "PSMServer_02"}}],
            psm_servers=[
                {"ID": "PSMServer_01", "Name": "PSM One", "Address": "10.0.0.1"},
            ],
        )
        psm_objects = {item.source_id: item for item in objects if item.object_type == "psm"}
        self.assertEqual(psm_objects["PSMServer_01"].attributes["address"], "10.0.0.1")
        # Referenced by a platform but absent from the catalog: keep the historical minimal fallback.
        self.assertIn("PSMServer_02", psm_objects)
        self.assertEqual(psm_objects["PSMServer_02"].attributes, {})
        self.assertEqual(relationships[0].target_id, "PSMServer_02")

    def test_isolated_psm_refresh_persists_renamed_server_from_authoritative_catalog(self):
        run_id = uuid4()
        with patch("app.pam_inventory.fetch_psm_servers", new=AsyncMock(return_value=[
            {"ID": "PSMServer_01", "Name": "UPAY-02", "Address": "10.0.0.1"},
        ])), \
             patch("app.pam_inventory.sync_inventory_snapshot", new=AsyncMock(return_value={"objects": 1, "relationships": 0})) as sync:
            result = asyncio.run(sync_pam_connectors_inventory(object(), run_id))

        self.assertEqual(result["objects"], 1)
        objects = sync.await_args.args[1]
        self.assertEqual(objects[0].source_id, "PSMServer_01")
        self.assertEqual(objects[0].display_name, "UPAY-02")
        self.assertEqual(objects[0].attributes["address"], "10.0.0.1")
        self.assertEqual(sync.await_args.kwargs["reconcile_object_types"], frozenset({"psm"}))

    def test_psm_connector_catalog_has_no_relationships(self):
        objects, relationships = map_pam_objects(
            users=[], groups=[], platforms=[],
            psm_connectors=[{"ID": "PSM-RDP", "DisplayName": ""}, {"ID": "PSM-SSH", "DisplayName": "SSH"}],
        )
        connector_ids = [item.source_id for item in objects if item.object_type == "psm_connector"]
        self.assertEqual(connector_ids, ["PSM-RDP", "PSM-SSH"])
        self.assertEqual(objects[0].display_name, "PSM-RDP")
        self.assertEqual(objects[1].display_name, "SSH")
        self.assertEqual(relationships, [])

    def test_platform_catalogs_map_dependent_group_and_rotational(self):
        objects, _ = map_pam_objects(
            users=[], groups=[], platforms=[],
            platform_dependents=[{"ID": "D1", "Name": "Dep One", "PlatformBaseID": "Base1", "NumberOfLinkedTargetPlatforms": 3}],
            platform_groups=[{"ID": "G1", "Name": "Group One", "Active": True}],
            platform_rotational_groups=[{"ID": "R1", "Name": "Rot One", "Active": False}],
        )
        by_type = {item.object_type: item for item in objects}
        self.assertEqual(by_type["platform_dependent"].attributes["linked_target_platforms"], 3)
        self.assertEqual(by_type["platform_group"].attributes["active"], True)
        self.assertEqual(by_type["platform_rotational_group"].attributes["active"], False)

    def test_component_health_excludes_host_ip_and_username(self):
        objects, _ = map_pam_objects(
            users=[], groups=[], platforms=[],
            components_summary={"Components": [
                {"ComponentID": "PVWA", "ComponentName": "PVWA", "ComponentTotalCount": 2, "ConnectedComponentCount": 1, "Description": "Portal"},
            ]},
            components_detail={"PVWA": [
                {"ComponentIP": "10.0.0.5", "ComponentUserName": "svc", "ComponentVersion": "14.2", "IsLoggedOn": True, "LastLogonDate": 1725900000},
                {"ComponentIP": "10.0.0.6", "ComponentUserName": "svc2", "ComponentVersion": "14.2", "IsLoggedOn": False, "LastLogonDate": 1725800000},
            ]},
        )
        component = objects[0]
        self.assertEqual(component.object_type, "component")
        self.assertEqual(component.attributes["total_count"], 2)
        self.assertEqual(component.attributes["connected_count"], 1)
        self.assertEqual(component.attributes["instance_versions"], ["14.2"])
        self.assertEqual(component.attributes["latest_logon_at"], 1725900000)
        self.assertEqual(component.attributes["all_instances_logged_on"], False)
        self.assertNotIn("ComponentIP", str(component.attributes))
        self.assertNotIn("10.0.0.5", str(component.attributes))
        self.assertNotIn("ComponentUserName", str(component.attributes))

    def test_aim_applications_exclude_business_owner_fields(self):
        objects, _ = map_pam_objects(
            users=[], groups=[], platforms=[],
            aim_applications=[{
                "AppID": "App1", "Description": "Finance batch job", "Disabled": False,
                "ExpirationDate": "12/31/2027", "Location": "\\",
                "BusinessOwnerEmail": "owner@example.com", "BusinessOwnerFName": "Jane", "BusinessOwnerLName": "Doe", "BusinessOwnerPhone": "+1-555-0100",
            }],
        )
        application = objects[0]
        self.assertEqual(application.object_type, "aim_application")
        self.assertEqual(application.attributes, {
            "description": "Finance batch job", "disabled": False, "expiration_date": "12/31/2027", "location": "\\",
        })
        self.assertNotIn("owner@example.com", str(application.attributes))


if __name__ == "__main__":
    unittest.main()
