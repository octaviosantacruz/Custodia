"""DOCS-GEN-002: docs/architecture/access-catalog.md is generated from the migrated catalog.

Opt-in like every PostgreSQL integration test: it needs CUSTODIA_TEST_DATABASE_URL
pointing at a database with the migrations applied (``npm run verify`` provides one).
"""

import importlib.util
import os
import pathlib
import unittest

import psycopg

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / 'scripts' / 'generate_access_catalog.py'
REFERENCE = REPO_ROOT / 'docs' / 'architecture' / 'access-catalog.md'


def _load_generator():
    spec = importlib.util.spec_from_file_location('generate_access_catalog', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AccessCatalogReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ.get('CUSTODIA_TEST_DATABASE_URL', '').strip()
        if not url:
            raise unittest.SkipTest('CUSTODIA_TEST_DATABASE_URL no está configurada; ver tests/support/pg_integration_base.py.')
        cls.generator = _load_generator()
        try:
            cls.connection = psycopg.connect(url, connect_timeout=5)
        except psycopg.OperationalError as exc:
            raise unittest.SkipTest(f'Postgres no alcanzable: {exc.__class__.__name__}') from exc
        cls.addClassCleanup(cls.connection.close)
        cls.body = cls.generator.build_body(cls.connection)

    def test_committed_file_matches_the_migrated_catalog(self):
        committed = REFERENCE.read_text()
        expected = self.generator.render(self.connection, committed)
        self.assertEqual(
            committed,
            expected,
            f'{REFERENCE.relative_to(REPO_ROOT)} está desactualizado; regeneralo con: {self.generator.REGENERATE}',
        )

    def test_every_documented_role_permission_exists_in_the_permission_table(self):
        with self.connection.cursor() as cursor:
            cursor.execute(
                'SELECT DISTINCT grants.permission_code FROM public.access_role_permissions grants '
                'LEFT JOIN public.access_permissions permission USING (permission_code) '
                'WHERE permission.permission_code IS NULL'
            )
            orphans = [row[0] for row in cursor.fetchall()]
        self.assertEqual(orphans, [], 'Hay permisos concedidos a roles que no existen en access_permissions.')

    def test_platform_admin_holds_every_active_permission(self):
        """ACCESS-ROLES-003: a permission added by a migration must also be granted to `admin`."""
        with self.connection.cursor() as cursor:
            cursor.execute(
                "SELECT permission.permission_code FROM public.access_permissions permission "
                "WHERE permission.lifecycle_status = 'active' AND NOT EXISTS ("
                "SELECT 1 FROM public.access_role_permissions grant_row "
                "WHERE grant_row.role_code = 'admin' AND grant_row.permission_code = permission.permission_code) "
                "ORDER BY 1"
            )
            missing = [row[0] for row in cursor.fetchall()]
        self.assertEqual(missing, [], 'El rol admin debe tener todos los permisos activos; agregalos en la misma migración.')

    def test_known_anchors_are_documented(self):
        for anchor in ('`access:manage`', '`cyberark_admin`', '`netskope_reader`', '## Dominios y niveles'):
            self.assertIn(anchor, self.body)


if __name__ == '__main__':
    unittest.main()
