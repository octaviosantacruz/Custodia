import unittest

from app.services.identity_admin_mapping import SOURCE_SYSTEM, map_identity_admin_objects, map_identity_federations


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

    def test_collapses_duplicate_scim_ids_sharing_an_email(self):
        older = _user(
            user_id="user-old", groups=[{"display": "Role A", "value": "role-a"}],
            **{"urn:ietf:params:scim:schemas:cyberark:1.0:User": {"lastLoginDate": "2026-06-01T00:00:00Z"}},
        )
        newer = _user(
            user_id="user-new", groups=[{"display": "Role B", "value": "role-b"}],
            **{"urn:ietf:params:scim:schemas:cyberark:1.0:User": {"lastLoginDate": "2026-08-01T00:00:00Z"}},
        )
        groups = [_group(group_id="role-a", display_name="Role A"), _group(group_id="role-b", display_name="Role B")]
        objects, relationships = map_identity_admin_objects(users=[older, newer], groups=groups)
        user_objects = [item for item in objects if item.object_type == "user"]
        self.assertEqual(len(user_objects), 1)
        self.assertEqual(user_objects[0].source_id, "user-new")
        role_ids = sorted(r.target_id for r in relationships)
        self.assertEqual(role_ids, ["role-a", "role-b"])

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
