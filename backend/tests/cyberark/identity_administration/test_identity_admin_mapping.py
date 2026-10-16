import unittest

from app.cyberark.identity_administration.services.identity_admin_mapping import SOURCE_SYSTEM, map_identity_admin_objects, map_identity_federations


def _user(user_id="user-1", groups=None, **overrides):
    payload = {
        "id": user_id,
        "userName": "jperez@example.com",
        "displayName": "Juana Perez",
        "active": True,
        "emails": [{"type": "work", "primary": True, "value": "juana.perez@example.com"}],
        "groups": groups or [],
        "meta": {"lastModified": "2026-06-01T09:30:00.000000Z"},
        "urn:ietf:params:scim:schemas:cyberark:1.0:User": {
            "serviceUser": False, "oauthClient": False, "lastLoginDate": "2026-06-09T17:32:31Z",
        },
    }
    payload.update(overrides)
    return payload


def _group(group_id="role-1", display_name="Privilege Cloud Administrators"):
    return {
        "id": group_id,
        "displayName": display_name,
        "meta": {"lastModified": "2026-01-10T12:00:00.000000Z"},
    }


class IdentityAdminMappingTests(unittest.TestCase):
    def test_preserves_direct_scim_layers_and_reports_unresolved_members(self):
        parent = {**_group("admin", "Administration Role"), "members": [{"value": "system", "type": "Group"}]}
        system = {**_group("system", "System Administrator"), "members": [{"value": "user-1", "type": "User"}, {"value": "okta", "type": "Group"}, {"value": "missing", "type": "User", "display": "apiuser@cyberark.cloud", "$ref": "https://private.example/Users/missing"}]}
        okta = {**_group("okta", "sg_cyberark_admin"), "members": []}
        objects, edges = map_identity_admin_objects([_user()], [parent, system, okta])
        direct = {(edge.source_id, edge.target_id) for edge in edges if edge.relationship_type == "identity_member_of"}
        self.assertEqual(direct, {("system", "admin"), ("user-1", "system"), ("okta", "system")})
        self.assertEqual(objects[1].attributes["unresolved_member_count"], 1)
        self.assertEqual(objects[1].attributes["unresolved_members"], [{"source_id": "missing", "display_name": "apiuser@cyberark.cloud", "kind": "user"}])
        self.assertEqual(objects[2].attributes["membership_status"], "complete")
        objects, _ = map_identity_admin_objects([_user()], [_group()])
        self.assertEqual(objects[0].attributes["membership_status"], "not_reported")

    def test_maps_users_and_roles_with_source_system(self):
        objects, _ = map_identity_admin_objects(users=[_user()], groups=[_group()])
        self.assertEqual([(item.object_type, item.source_id, item.source_system) for item in objects], [
            ("role", "role-1", SOURCE_SYSTEM),
            ("user", "user-1", SOURCE_SYSTEM),
        ])

    def test_maps_user_has_role_only_for_known_groups(self):
        user = _user(groups=[
            {"display": "Privilege Cloud Administrators", "value": "role-1"},
            {"display": "Some Deleted Role", "value": "role-unknown"},
        ])
        _, relationships = map_identity_admin_objects(users=[user], groups=[_group()])
        self.assertEqual(len(relationships), 1)
        relationship = relationships[0]
        self.assertEqual(relationship.source_type, "user")
        self.assertEqual(relationship.source_id, "user-1")
        self.assertEqual(relationship.target_type, "role")
        self.assertEqual(relationship.target_id, "role-1")
        self.assertEqual(relationship.relationship_type, "user_has_role")
        self.assertEqual(relationship.source_system, SOURCE_SYSTEM)

    def test_extracts_primary_email_and_cyberark_extension_fields(self):
        objects, _ = map_identity_admin_objects(users=[_user()], groups=[])
        attributes = objects[0].attributes
        self.assertEqual(attributes["email"], "juana.perez@example.com")
        self.assertEqual(attributes["user_name"], "jperez@example.com")
        self.assertIs(attributes["active"], True)
        self.assertIs(attributes["service_user"], False)

    def test_rejects_user_without_id(self):
        with self.assertRaises(ValueError):
            map_identity_admin_objects(users=[{"userName": "no-id"}], groups=[])

    def test_rejects_group_without_id_or_display_name(self):
        with self.assertRaises(ValueError):
            map_identity_admin_objects(users=[], groups=[{"id": "role-1"}])
        with self.assertRaises(ValueError):
            map_identity_admin_objects(users=[], groups=[{"displayName": "No id"}])

    def test_preserves_distinct_accounts_sharing_email_and_their_direct_memberships(self):
        person = _user(user_id="person", userName="juan@example.com")
        admin = _user(user_id="admin", userName="admin@cyberark.cloud", groups=[{"value": "system"}])
        service = _user(user_id="service", userName="soporte@cyberark.cloud")
        system = {**_group("system", "System Administrator"), "members": [
            {"value": "admin", "type": "User"}, {"value": "service", "type": "User"},
        ]}
        objects, relationships = map_identity_admin_objects([person, admin, service], [system])
        self.assertEqual({item.source_id for item in objects if item.object_type == "user"}, {"person", "admin", "service"})
        self.assertEqual({(edge.source_id, edge.target_id) for edge in relationships if edge.relationship_type == "identity_member_of"}, {("admin", "system"), ("service", "system")})
        self.assertEqual(objects[0].attributes["unresolved_member_count"], 0)

    def test_does_not_merge_users_without_email(self):
        first = _user(user_id="user-1", emails=[])
        second = _user(user_id="user-2", emails=[])
        objects, _ = map_identity_admin_objects(users=[first, second], groups=[])
        self.assertEqual(len([item for item in objects if item.object_type == "user"]), 2)


class IdentityFederationMappingTests(unittest.TestCase):
    def test_maps_only_core_fields(self):
        federations = [{
            "FederationUuid": "f1", "FederationName": "Okta SSO", "FederationType": "SAML",
            "Active": True, "Role": "idp", "Usage": "sso",
            "Config": {"cert": "-----BEGIN CERTIFICATE-----..."},
            "Domains": ["example.com"], "Apps": ["app1"], "CyberarkServices": ["svc1"],
        }]
        objects = map_identity_federations(federations)
        self.assertEqual(len(objects), 1)
        obj = objects[0]
        self.assertEqual(obj.object_type, "identity_federation")
        self.assertEqual(obj.source_system, SOURCE_SYSTEM)
        self.assertEqual(obj.source_id, "f1")
        self.assertEqual(obj.display_name, "Okta SSO")
        self.assertEqual(obj.attributes, {
            "federation_type": "SAML", "active": True, "role": "idp", "usage": "sso",
        })

    def test_excludes_config_domains_apps_and_services(self):
        federations = [{
            "FederationUuid": "f1",
            "Config": {"cert": "SECRET-CERT-DATA"},
            "Domains": ["private.example.com"], "Apps": ["internal-app"], "CyberarkServices": ["internal-svc"],
        }]
        obj = map_identity_federations(federations)[0]
        keys = set(obj.attributes.keys())
        self.assertNotIn("config", keys)
        self.assertNotIn("domains", keys)
        self.assertNotIn("apps", keys)
        self.assertNotIn("cyberark_services", keys)
        rendered = str(obj.attributes.values())
        self.assertNotIn("SECRET-CERT-DATA", rendered)
        self.assertNotIn("private.example.com", rendered)
        self.assertNotIn("internal-app", rendered)
        self.assertNotIn("internal-svc", rendered)

    def test_falls_back_to_uuid_when_name_missing(self):
        obj = map_identity_federations([{"FederationUuid": "f1"}])[0]
        self.assertEqual(obj.display_name, "f1")

    def test_rejects_federation_without_uuid(self):
        with self.assertRaises(ValueError):
            map_identity_federations([{"FederationName": "no-uuid"}])


if __name__ == "__main__":
    unittest.main()
