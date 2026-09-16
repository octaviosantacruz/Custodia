import unittest

from app.api.routes.cmdb import router


def _dependency_permission_sets(route):
    """Flatten the permission_code(s) captured by each dependency's closure.

    require_permission("x") closes over the string "x"; require_any_permission("a", "b")
    closes over the tuple ("a", "b"). Either way we normalize to a list of tuples so a
    route's declared permission options are easy to assert against.
    """
    sets = []
    for dependency in route.dependant.dependencies:
        for cell in dependency.call.__closure__ or ():
            value = cell.cell_contents
            if isinstance(value, str):
                sets.append((value,))
            elif isinstance(value, tuple) and value and all(isinstance(item, str) for item in value):
                sets.append(value)
    return sets


class PamChainAdminAccessTests(unittest.TestCase):
    def test_dedicated_chain_routes_still_accept_access_manage(self):
        """access:manage must keep working, unchanged, on every route this migration touched."""
        protected_paths = {
            "/api/cmdb/pam-users",
            "/api/cmdb/pam-users/{object_id}/chain",
            "/api/cmdb/pam-platforms",
            "/api/cmdb/pam-connectors",
            "/api/cmdb/pam-psm-connector-types",
            "/api/cmdb/pam-components",
            "/api/cmdb/pam-platform-catalogs",
            "/api/cmdb/pam-platform-targets",
            "/api/cmdb/pam-aim-applications",
            "/api/cmdb/access-assets",
            "/api/cmdb/sia-connectors",
            "/api/cmdb/sia-resources",
            "/api/cmdb/sia-database-accounts",
            "/api/cmdb/identity-federations",
            "/api/cmdb/identity-federations/{object_id}",
        }
        routes = {route.path: route for route in router.routes if route.path in protected_paths}
        self.assertEqual(set(routes), protected_paths)

        for path, route in routes.items():
            permission_sets = _dependency_permission_sets(route)
            self.assertTrue(
                any("access:manage" in options for options in permission_sets),
                f"{path} no acepta access:manage",
            )

    def test_pam_catalog_routes_also_accept_the_narrow_pam_permission(self):
        pam_paths = {
            "/api/cmdb/pam-users",
            "/api/cmdb/pam-users/{object_id}/chain",
            "/api/cmdb/pam-platforms",
            "/api/cmdb/pam-connectors",
            "/api/cmdb/pam-psm-connector-types",
            "/api/cmdb/pam-components",
            "/api/cmdb/pam-platform-catalogs",
            "/api/cmdb/pam-platform-targets",
            "/api/cmdb/pam-aim-applications",
            "/api/cmdb/access-assets",
        }
        routes = {route.path: route for route in router.routes if route.path in pam_paths}
        self.assertEqual(set(routes), pam_paths)

        for path, route in routes.items():
            permission_sets = _dependency_permission_sets(route)
            self.assertTrue(
                any("pam:catalogs_read" in options for options in permission_sets),
                f"{path} no acepta pam:catalogs_read",
            )

    def test_sia_catalog_routes_also_accept_the_narrow_sia_permission(self):
        sia_paths = {
            "/api/cmdb/sia-connectors",
            "/api/cmdb/sia-resources",
            "/api/cmdb/sia-database-accounts",
        }
        routes = {route.path: route for route in router.routes if route.path in sia_paths}
        self.assertEqual(set(routes), sia_paths)

        for path, route in routes.items():
            permission_sets = _dependency_permission_sets(route)
            self.assertTrue(
                any("sia:catalogs_read" in options for options in permission_sets),
                f"{path} no acepta sia:catalogs_read",
            )

    def test_identity_federation_routes_also_accept_the_narrow_identity_permission(self):
        identity_paths = {
            "/api/cmdb/identity-federations",
            "/api/cmdb/identity-federations/{object_id}",
        }
        routes = {route.path: route for route in router.routes if route.path in identity_paths}
        self.assertEqual(set(routes), identity_paths)

        for path, route in routes.items():
            permission_sets = _dependency_permission_sets(route)
            self.assertTrue(
                any("identity:catalogs_read" in options for options in permission_sets),
                f"{path} no acepta identity:catalogs_read",
            )


if __name__ == "__main__":
    unittest.main()
