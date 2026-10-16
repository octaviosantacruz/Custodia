"""DOCS-GEN-001: docs/architecture/api-reference.md is generated from the mounted app.

The committed file must match what the code produces, and the access column must
reflect the real route dependencies (so dropping a Depends(require_permission(...))
shows up as a documentation diff as well as in test_permission_http_matrix.py).
"""

import importlib.util
import os
import pathlib
import unittest

os.environ.update({
    'DATABASE_URL': 'postgresql://test:test@127.0.0.1:5432/cmdb',
    'SESSION_SECRET': 'test-only-session-secret-at-least-32-bytes',
    'INGESTION_INTERVAL_MINUTES': '1440',
    'AUTH_MODE': 'local',
    'SESSION_HTTPS_ONLY': 'false',
})

from app.main import app  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / 'scripts' / 'generate_api_reference.py'
REFERENCE = REPO_ROOT / 'docs' / 'architecture' / 'api-reference.md'


def _load_generator():
    spec = importlib.util.spec_from_file_location('generate_api_reference', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ApiReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generator = _load_generator()
        cls.body = cls.generator.build_body(app)

    def test_committed_reference_matches_the_mounted_routes(self):
        _, committed = self.generator.split_frontmatter(REFERENCE.read_text())
        # assertTrue keeps the failure short: a diff of the whole table would bury the instruction.
        self.assertTrue(
            committed.lstrip('\n') == self.body,
            f"{REFERENCE.relative_to(REPO_ROOT)} está desactualizado. Regeneralo con: {self.generator.REGENERATE}",
        )

    def _row(self, method, path):
        prefix = f'| {method} | `{path}` |'
        rows = [line for line in self.body.splitlines() if line.startswith(prefix)]
        self.assertEqual(len(rows), 1, f'{method} {path} debería aparecer una vez')
        return rows[0]

    def test_write_permission_routes_show_their_codes_and_that_they_are_writes(self):
        row = self._row('POST', '/api/access/roles')
        self.assertIn('`access:roles_manage`', row)
        self.assertIn('(escritura)', row)

    def test_read_permission_routes_are_marked_as_reads(self):
        row = self._row('GET', '/api/accounts/export.csv')
        self.assertIn('`inventory:export` (lectura)', row)

    def test_route_specific_guards_are_not_reported_as_public(self):
        row = self._row('GET', '/api/chains/person/coverage')
        self.assertIn('dependencia propia `require_person_client_coverage_read`', row)
        self.assertNotIn('pública', row)

    def test_only_login_bootstrap_and_health_style_routes_are_public(self):
        public = sorted(
            line.split('`')[1]
            for line in self.body.splitlines()
            if line.startswith('| ') and '| pública' in line
        )
        self.assertTrue(public, 'debería haber rutas públicas (login, estado, salud)')
        allowed_prefixes = ('/api/auth/', '/api/health', '/health')
        offenders = [path for path in public if not path.startswith(allowed_prefixes)]
        self.assertEqual(offenders, [], 'una ruta sin dependencia de autorización fuera de auth/salud: ¿se perdió un Depends?')


if __name__ == '__main__':
    unittest.main()
