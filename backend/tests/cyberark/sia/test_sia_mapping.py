import unittest

from app.cyberark.sia.services.sia_mapping import (
    SOURCE_SYSTEM, map_sia_connectors, map_sia_database_strong_accounts, map_sia_objects,
    map_sia_target_sets,
    map_sia_virtual_machines,
)


def _policy(policy_id="p1", **overrides):
    payload = {"policyId": policy_id, "policyName": "Acceso-Linux-Test", "status": "Enabled", "description": "desc", "platforms": ["OnPrem"], "ruleNames": ["Rule1"]}
    payload.update(overrides)
    return payload


def _detail(policy_type="VM", rules=None):
    return {"policyType": policy_type, "userAccessRules": rules or []}


class SiaMappingTests(unittest.TestCase):
    def test_maps_policy_with_source_system(self):
        objects = map_sia_objects([_policy()], {"p1": _detail()})
        self.assertEqual(len(objects), 1)
        obj = objects[0]
        self.assertEqual(obj.object_type, "access_policy")
        self.assertEqual(obj.source_id, "p1")
        self.assertEqual(obj.source_system, SOURCE_SYSTEM)
        self.assertEqual(obj.attributes["status"], "Enabled")
        self.assertEqual(obj.attributes["platforms"], ["OnPrem"])

    def test_extracts_grantees_from_user_access_rules(self):
        rules = [{
            "ruleName": "Rule1",
            "userData": {
                "users": [{"name": "user@example.com", "source": "Custodia Cloud Directory"}],
                "groups": [{"name": "Ops"}],
                "roles": [],
            },
        }]
        objects = map_sia_objects([_policy()], {"p1": _detail(rules=rules)})
        attributes = objects[0].attributes
        self.assertEqual(attributes["granted_users"], ["user@example.com"])
        self.assertEqual(attributes["granted_groups"], ["Ops"])
        self.assertEqual(attributes["granted_roles"], [])

    def test_preserves_on_prem_destination_rules(self):
        detail = _detail()
        detail["providersData"] = {"OnPrem": {
            "ipRules": ["10.67.10.186", {"range": "10.67.13.0/24"}],
            "fqdnRules": ["db.example.internal"],
            "logicalNames": ["finance-db"],
        }}
        attributes = map_sia_objects([_policy()], {"p1": detail})[0].attributes
        self.assertEqual(attributes["ip_rules"], ["10.67.10.186", {"range": "10.67.13.0/24"}])
        self.assertEqual(attributes["fqdn_rules"], ["db.example.internal"])
        self.assertEqual(attributes["logical_names"], ["finance-db"])

    def test_deduplicates_grantees_across_rules(self):
        rules = [
            {"userData": {"users": [{"name": "a@example.com"}]}},
            {"userData": {"users": [{"name": "a@example.com"}]}},
        ]
        objects = map_sia_objects([_policy()], {"p1": _detail(rules=rules)})
        self.assertEqual(objects[0].attributes["granted_users"], ["a@example.com"])

    def test_handles_missing_detail(self):
        objects = map_sia_objects([_policy()], {})
        self.assertEqual(objects[0].attributes["granted_users"], [])
        self.assertEqual(objects[0].attributes["policy_type"], "")

    def test_rejects_policy_without_id(self):
        with self.assertRaises(ValueError):
            map_sia_objects([{"policyName": "no-id"}], {})


class SiaConnectorMappingTests(unittest.TestCase):
    def test_maps_confirmed_fields(self):
        connectors = [{
            "id": "c1", "status": "connected", "statusCode": "OK", "version": "14.2",
            "isLatestVersion": True, "os": "linux", "region": "us-east-1",
            "workspaceId": "ws1", "activeSessionsCount": 3,
            "hostIp": "10.0.0.5", "hostName": "conn-01", "hostNetwork": "10.0.0.0/24",
            "hostSubnet": "10.0.0.0/24", "hostInstanceId": "i-abc123",
        }]
        objects = map_sia_connectors(connectors)
        self.assertEqual(len(objects), 1)
        obj = objects[0]
        self.assertEqual(obj.object_type, "sia_connector")
        self.assertEqual(obj.source_system, SOURCE_SYSTEM)
        self.assertEqual(obj.source_id, "c1")
        self.assertEqual(obj.attributes["status"], "connected")
        self.assertEqual(obj.attributes["is_latest_version"], True)
        self.assertEqual(obj.attributes["active_sessions_count"], 3)

    def test_excludes_host_and_network_fields(self):
        connectors = [{
            "id": "c1", "hostIp": "10.0.0.5", "hostName": "conn-01",
            "hostNetwork": "10.0.0.0/24", "hostSubnet": "10.0.0.0/24",
            "hostInstanceId": "i-abc123", "proxySettings": "some-value",
        }]
        obj = map_sia_connectors(connectors)[0]
        keys = set(obj.attributes.keys())
        self.assertNotIn("hostIp", keys)
        self.assertNotIn("hostName", keys)
        self.assertNotIn("hostNetwork", keys)
        self.assertNotIn("hostSubnet", keys)
        self.assertNotIn("hostInstanceId", keys)
        self.assertNotIn("proxySettings", keys)
        self.assertNotIn("10.0.0.5", str(obj.attributes.values()))

    def test_is_latest_version_defaults_to_false_for_non_boolean(self):
        obj = map_sia_connectors([{"id": "c1", "isLatestVersion": "yes"}])[0]
        self.assertFalse(obj.attributes["is_latest_version"])

    def test_rejects_connector_without_id(self):
        with self.assertRaises(ValueError):
            map_sia_connectors([{"status": "connected"}])


class SiaVirtualMachineMappingTests(unittest.TestCase):
    def test_maps_confirmed_fields(self):
        machines = [{
            "machineId": "vm1", "name": "web-01", "osType": "linux",
            "locationType": "cloud", "discoveryEngine": "aws", "scannedOn": "2026-09-01T00:00:00Z",
            "ip": "10.0.0.9", "fqdn": "web-01.internal", "networkName": "prod-net",
        }]
        objects = map_sia_virtual_machines(machines)
        self.assertEqual(len(objects), 1)
        obj = objects[0]
        self.assertEqual(obj.object_type, "sia_resource")
        self.assertEqual(obj.source_system, SOURCE_SYSTEM)
        self.assertEqual(obj.source_id, "vm1")
        self.assertEqual(obj.display_name, "web-01")
        self.assertEqual(obj.attributes["resource_type"], "virtual_machine")
        self.assertEqual(obj.attributes["os_type"], "linux")

    def test_excludes_host_and_network_fields(self):
        machines = [{"machineId": "vm1", "ip": "10.0.0.9", "fqdn": "web-01.internal", "networkName": "prod-net"}]
        obj = map_sia_virtual_machines(machines)[0]
        keys = set(obj.attributes.keys())
        self.assertNotIn("ip", keys)
        self.assertNotIn("fqdn", keys)
        self.assertNotIn("networkName", keys)
        self.assertNotIn("10.0.0.9", str(obj.attributes.values()))
        self.assertNotIn("web-01.internal", str(obj.attributes.values()))

    def test_falls_back_to_machine_id_when_name_missing(self):
        obj = map_sia_virtual_machines([{"machineId": "vm1"}])[0]
        self.assertEqual(obj.display_name, "vm1")

    def test_rejects_machine_without_id(self):
        with self.assertRaises(ValueError):
            map_sia_virtual_machines([{"name": "no-id"}])


class SiaDatabaseStrongAccountMappingTests(unittest.TestCase):
    def test_maps_confirmed_fields(self):
        accounts = [{
            "id": "db1", "name": "app-db-account", "storeType": "mysql",
            "createdAt": "2026-09-01T00:00:00Z", "modifiedAt": "2026-09-02T00:00:00Z",
            "accountProperties": {"platform": "MySQL", "port": 3306, "database": "app"},
        }]
        objects = map_sia_database_strong_accounts(accounts)
        self.assertEqual(len(objects), 1)
        obj = objects[0]
        self.assertEqual(obj.object_type, "sia_database_account")
        self.assertEqual(obj.source_system, SOURCE_SYSTEM)
        self.assertEqual(obj.source_id, "db1")
        self.assertEqual(obj.display_name, "app-db-account")
        self.assertEqual(obj.attributes["store_type"], "mysql")
        self.assertEqual(obj.attributes["platform"], "MySQL")
        self.assertEqual(obj.attributes["port"], 3306)
        self.assertEqual(obj.attributes["database"], "app")

    def test_excludes_address_and_username(self):
        accounts = [{
            "id": "db1",
            "accountProperties": {
                "platform": "MySQL", "port": 3306, "database": "app",
                "address": "10.0.0.5", "username": "root",
            },
        }]
        obj = map_sia_database_strong_accounts(accounts)[0]
        keys = set(obj.attributes.keys())
        self.assertNotIn("address", keys)
        self.assertNotIn("username", keys)
        self.assertNotIn("10.0.0.5", str(obj.attributes.values()))
        self.assertNotIn("root", str(obj.attributes.values()))

    def test_falls_back_to_id_when_name_missing(self):
        obj = map_sia_database_strong_accounts([{"id": "db1"}])[0]
        self.assertEqual(obj.display_name, "db1")

    def test_rejects_account_without_id(self):
        with self.assertRaises(ValueError):
            map_sia_database_strong_accounts([{"name": "no-id"}])

    def test_accepts_port_as_a_numeric_string(self):
        obj = map_sia_database_strong_accounts([{"id": "db1", "accountProperties": {"port": "3306"}}])[0]
        self.assertEqual(obj.attributes["port"], 3306)

    def test_leaves_port_as_none_when_missing_or_not_numeric(self):
        obj = map_sia_database_strong_accounts([{"id": "db1", "accountProperties": {"port": "not-a-port"}}])[0]
        self.assertIsNone(obj.attributes["port"])
        obj_missing = map_sia_database_strong_accounts([{"id": "db2"}])[0]
        self.assertIsNone(obj_missing.attributes["port"])


class SiaTargetSetMappingTests(unittest.TestCase):
    def test_maps_only_the_approved_target_set_allowlist(self):
        item = {
            "name": "Linux target set",
            "type": "Linux",
            "description": "Managed targets",
            "provision_format": "JSON",
            "enable_certificate_validation": True,
            "secret_id": "secret-reference-should-not-persist",
            "secret_type": "password",
            "entries": [{"ip": "192.0.2.50", "target": "private-target"}],
            "targets": ["another-private-target"],
            "tenant_extra": "unapproved-value",
        }

        obj = map_sia_target_sets([item])[0]

        self.assertEqual((obj.source_system, obj.object_type), ("sia", "sia_target_set"))
        self.assertEqual((obj.source_id, obj.display_name), ("Linux target set", "Linux target set"))
        self.assertEqual(obj.attributes, {
            "target_type": "Linux",
            "description": "Managed targets",
            "provisioning_format": "JSON",
            "certificate_validation": True,
        })
        self.assertNotIn("secret-reference-should-not-persist", str(obj.attributes))
        self.assertNotIn("password", str(obj.attributes))
        self.assertNotIn("192.0.2.50", str(obj.attributes))
        self.assertNotIn("private-target", str(obj.attributes))
        self.assertNotIn("tenant_extra", obj.attributes)

    def test_missing_certificate_validation_remains_unknown(self):
        obj = map_sia_target_sets([{"name": "Target"}])[0]
        self.assertIsNone(obj.attributes["certificate_validation"])
        self.assertIsNone(map_sia_target_sets([{"name": "Target", "enable_certificate_validation": "false"}])[0].attributes["certificate_validation"])

    def test_rejects_target_set_without_name(self):
        with self.assertRaises(ValueError):
            map_sia_target_sets([{"type": "Linux"}])


if __name__ == "__main__":
    unittest.main()
