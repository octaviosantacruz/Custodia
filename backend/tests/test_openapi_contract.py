import os
import unittest

os.environ.update({
    'DATABASE_URL': 'postgresql://test:test@127.0.0.1:5432/cmdb',
    'SESSION_SECRET': 'test-only-session-secret-at-least-32-bytes',
    'INGESTION_INTERVAL_MINUTES': '1440',
    'AUTH_MODE': 'local',
    'SESSION_HTTPS_ONLY': 'false',
})

from app.main import app


class OpenApiContractTests(unittest.TestCase):
    def test_inventory_and_export_routes_are_published(self):
        paths = app.openapi()['paths']
        expected = {
            '/api/accounts',
            '/api/accounts/export.csv',
            '/api/analytics/account-platform-coverage',
            '/api/analytics/executive',
            '/api/connection-inventory',
            '/api/search',
            '/api/safes/export.csv',
            '/api/safes/{safe_number}/accounts',
            '/api/cmdb/coverage',
            '/api/cmdb/pam-roles',
            '/api/cmdb/pam-roles/{object_id}',
            '/api/cmdb/pam-users',
            '/api/cmdb/pam-users/{object_id}/chain',
            '/api/findings',
            '/api/findings/refresh',
            '/api/findings/{finding_id}',
            '/api/dashboard/preferences',
            '/api/workspaces/preferences',
        }
        self.assertTrue(expected.issubset(paths))
        for path in expected - {'/api/findings/refresh', '/api/findings/{finding_id}'}:
            self.assertIn('get', paths[path])
        self.assertIn('post', paths['/api/findings/refresh'])
        self.assertIn('patch', paths['/api/findings/{finding_id}'])
        self.assertIn('put', paths['/api/dashboard/preferences'])
        self.assertIn('put', paths['/api/workspaces/preferences'])

    def test_logout_is_post_only(self):
        logout = app.openapi()['paths']['/api/auth/logout']
        self.assertIn('post', logout)
        self.assertNotIn('get', logout)

    def test_sensitive_route_surface_is_fully_published(self):
        """AUD-API-001: the earlier `expected` set only sampled a handful of
        paths, leaving ~14+ cmdb.py routes (all of Identity Administration,
        SIA and the PAM technical catalogs) and entire mutation-heavy
        modules (safe_write.py, access_control.py, users.py,
        safe_lifecycle.py) unasserted. A route silently dropped, renamed, or
        losing its permission `dependencies=[...]` would not fail any test.

        This asserts every path+method these five modules declare in code
        (grepped from their @router.* decorators) is present in the
        generated OpenAPI schema -- catching a route disappearing from the
        published contract, not just from Python imports.
        """
        paths = app.openapi()['paths']

        # path -> set of expected HTTP methods
        expected_methods: dict[str, set[str]] = {
            # cmdb.py -- Identity Administration, PAM technical catalogs, SIA
            '/api/cmdb/coverage': {'get'},
            '/api/cmdb/identity-users': {'get'},
            '/api/cmdb/identity-users/{object_id}': {'get'},
            '/api/cmdb/identity-users/{object_id}/pam-chain': {'get'},
            '/api/cmdb/identity-roles': {'get'},
            '/api/cmdb/identity-roles/{object_id}': {'get'},
            '/api/cmdb/identity-federations': {'get'},
            '/api/cmdb/identity-federations/{object_id}': {'get'},
            '/api/cmdb/pam-roles': {'get'},
            '/api/cmdb/pam-roles/{object_id}': {'get'},
            '/api/cmdb/pam-users': {'get'},
            '/api/cmdb/pam-users/{object_id}/chain': {'get'},
            '/api/cmdb/pam-platforms': {'get'},
            '/api/cmdb/pam-platform-targets': {'get'},
            '/api/cmdb/pam-connectors': {'get'},
            '/api/cmdb/pam-psm-connector-types': {'get'},
            '/api/cmdb/pam-components': {'get'},
            '/api/cmdb/pam-platform-catalogs': {'get'},
            '/api/cmdb/pam-aim-applications': {'get'},
            '/api/cmdb/access-assets': {'get'},
            '/api/cmdb/sia-policies': {'get'},
            '/api/cmdb/sia-policies/{object_id}': {'get'},
            '/api/cmdb/sia-destinations': {'get'},
            '/api/cmdb/sia-connectors': {'get'},
            '/api/cmdb/sia-resources': {'get'},
            '/api/cmdb/sia-database-accounts': {'get'},
            # safe_write.py -- mutation-only, permission-gated
            '/api/accounts/{safe_number}/{account_id}/classification': {'patch'},
            '/api/safes/{safe_number}/assignment': {'patch'},
            '/api/safes/{safe_number}/scope': {'patch'},
            '/api/safes/{safe_number}/account-type': {'patch'},
            '/api/safes/bulk-assignment': {'post'},
            '/api/safes/{safe_number}/metadata': {'patch'},
            '/api/safes/{safe_number}/quick-update': {'patch'},
            # safe_lifecycle.py -- read-only, gate inherited from the safes router (AUD-SEC-002)
            '/api/safes/{safe_number}/audit': {'get'},
            '/api/lifecycle/retired': {'get'},
            # access_control.py -- prefix /api/access, access:manage-gated
            '/api/access/permissions': {'get', 'post'},
            '/api/access/roles': {'get', 'post'},
            '/api/access/domains': {'get'},
            '/api/access/roles/composite': {'post'},
            '/api/access/roles/{role_code}': {'patch'},
            '/api/access/roles/{role_code}/composite': {'patch'},
            # users.py -- local user admin, access:manage-gated
            '/api/auth/users': {'get', 'post'},
            '/api/auth/users/{user_id}': {'patch', 'delete'},
            '/api/auth/users/{user_id}/reissue-temp-password': {'post'},
        }

        missing_paths = sorted(set(expected_methods) - set(paths))
        self.assertEqual(missing_paths, [], f"routes missing from the published OpenAPI contract: {missing_paths}")

        mismatched: list[str] = []
        for path, methods in expected_methods.items():
            published = set(paths[path])
            if not methods.issubset(published):
                mismatched.append(f"{path}: expected {sorted(methods)}, published {sorted(published)}")
        self.assertEqual(mismatched, [], "method mismatch:\n" + "\n".join(mismatched))

    def test_sensitive_mutation_routes_publish_a_real_summary_and_description(self):
        """AUD-API-003: access_control.py and safe_write.py had zero
        summary/description across every operation, so Swagger showed raw
        function names (e.g. "Create Role Route") for the entire access-
        control and Safe-mutation surface. This asserts every mutating
        operation in those two modules publishes a non-empty, non-default
        summary and description -- FastAPI's function-name fallback summary
        always title-cases the function name and never contains a colon or
        a lowercase word describing a permission, so checking for those is
        enough to catch a reintroduced gap without hard-coding exact copy.
        """
        paths = app.openapi()['paths']
        operations = [
            ('/api/access/permissions', 'post'), ('/api/access/roles', 'post'),
            ('/api/access/roles/composite', 'post'), ('/api/access/roles/{role_code}', 'patch'),
            ('/api/access/roles/{role_code}/composite', 'patch'),
            ('/api/accounts/{safe_number}/{account_id}/classification', 'patch'),
            ('/api/safes/{safe_number}/assignment', 'patch'), ('/api/safes/{safe_number}/scope', 'patch'),
            ('/api/safes/{safe_number}/account-type', 'patch'), ('/api/safes/bulk-assignment', 'post'),
            ('/api/safes/{safe_number}/metadata', 'patch'), ('/api/safes/{safe_number}/quick-update', 'patch'),
        ]
        for path, method in operations:
            operation = paths[path][method]
            summary = operation.get('summary') or ''
            description = operation.get('description') or ''
            self.assertTrue(summary, f"{method.upper()} {path} has no summary")
            self.assertNotRegex(summary, r'^[A-Z][a-z]+( [A-Z][a-z]+)* Route$', f"{method.upper()} {path} still has the auto-generated function-name summary: {summary!r}")
            self.assertIn('Requiere', description, f"{method.upper()} {path} description doesn't name the required permission")

    def test_openapi_documents_authentication_and_public_boundaries(self):
        schema = app.openapi()
        schemes = schema['components']['securitySchemes']
        self.assertEqual(schemes['sessionCookie']['in'], 'cookie')
        self.assertEqual(schemes['accessToken']['name'], 'X-Access-Token')
        self.assertEqual(schemes['bootstrapToken']['name'], 'X-Bootstrap-Token')
        self.assertEqual(schema['paths']['/api/auth/status']['get']['security'], [])
        self.assertEqual(schema['paths']['/api/safes']['get']['security'], [{'sessionCookie': []}])
        self.assertEqual(schema['paths']['/api/safes/{safe_number}/metadata']['patch']['security'], [{'sessionCookie': []}, {'accessToken': []}])
        self.assertIn('No se exponen secretos', schema['info']['description'])
        self.assertEqual(schema['paths']['/api/auth/users']['get']['summary'], 'Listar usuarios de DS Hub')
        self.assertEqual(schema['paths']['/api/auth/login']['post']['summary'], 'Iniciar sesión local')
        self.assertTrue(schema['paths']['/api/auth/login']['post']['description'])
        self.assertTrue(schema['paths']['/api/safes']['get']['summary'])


if __name__ == '__main__':
    unittest.main()
