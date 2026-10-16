import unittest

from app.cyberark.pam.api.routes.chains import router as chains_router
from app.netskope.sse.api.routes.chains_netskope import router as chains_netskope_router
from app.cyberark.access.api.routes.cmdb_access import router as access_router
from app.cyberark.identity_administration.api.routes.cmdb_identity import router as identity_router
from app.netskope.sse.api.routes.cmdb_netskope import router as netskope_router
from app.cyberark.pam.api.routes.cmdb_pam import router as pam_router
from app.cyberark.sia.api.routes.cmdb_sia import router as sia_router

# The composed router in cmdb.py nests these per-source routers, so inspect
# them directly and keep this test independent of FastAPI's include internals.
SOURCE_ROUTERS = (
    pam_router, identity_router, sia_router, netskope_router, access_router,
    chains_router, chains_netskope_router,
)


def _all_routes():
    return [route for router in SOURCE_ROUTERS for route in router.routes]


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
            "/api/cmdb/access-assets",
            "/api/cmdb/sia-connectors",
            "/api/cmdb/sia-resources",
            "/api/cmdb/sia-database-accounts",
            "/api/cmdb/sia-target-sets",
            "/api/cmdb/identity-federations",
            "/api/cmdb/identity-federations/{object_id}",
            "/api/chains/pam/node",
            "/api/chains/pam/expand",
            "/api/chains/pam/search",
            "/api/chains/netskope/node",
            "/api/chains/netskope/expand",
            "/api/chains/netskope/search",
        }
        routes = {route.path: route for route in _all_routes() if route.path in protected_paths}
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
            "/api/cmdb/access-assets",
            "/api/chains/pam/node",
            "/api/chains/pam/expand",
            "/api/chains/pam/search",
        }
        routes = {route.path: route for route in _all_routes() if route.path in pam_paths}
        self.assertEqual(set(routes), pam_paths)

        for path, route in routes.items():
            permission_sets = _dependency_permission_sets(route)
            self.assertTrue(
                any("pam:catalogs_read" in options for options in permission_sets),
                f"{path} no acepta pam:catalogs_read",
            )

    def test_netskope_chain_routes_also_accept_the_narrow_netskope_permission(self):
        netskope_paths = {
            "/api/chains/netskope/node",
            "/api/chains/netskope/expand",
            "/api/chains/netskope/search",
        }
        routes = {route.path: route for route in _all_routes() if route.path in netskope_paths}
        self.assertEqual(set(routes), netskope_paths)

        for path, route in routes.items():
            permission_sets = _dependency_permission_sets(route)
            self.assertTrue(
                any("netskope:read" in options for options in permission_sets),
                f"{path} no acepta netskope:read",
            )

    def test_sia_catalog_routes_also_accept_the_narrow_sia_permission(self):
        sia_paths = {
            "/api/cmdb/sia-connectors",
            "/api/cmdb/sia-resources",
            "/api/cmdb/sia-database-accounts",
            "/api/cmdb/sia-target-sets",
        }
        routes = {route.path: route for route in _all_routes() if route.path in sia_paths}
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
        routes = {route.path: route for route in _all_routes() if route.path in identity_paths}
        self.assertEqual(set(routes), identity_paths)

        for path, route in routes.items():
            permission_sets = _dependency_permission_sets(route)
            self.assertTrue(
                any("identity:catalogs_read" in options for options in permission_sets),
                f"{path} no acepta identity:catalogs_read",
            )


if __name__ == "__main__":
    unittest.main()
