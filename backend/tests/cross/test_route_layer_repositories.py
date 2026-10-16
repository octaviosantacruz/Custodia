"""ARCH-LAYERS-002: routes (Controller) go through services, not repositories.

Routes -> services -> repositories. A module under ``api/routes/`` must not
import from a ``repositories`` package; the owning tool's ``services/`` does,
and decides transaction order and domain errors.

``LEGACY_ROUTES`` is empty and must stay empty: a route that imports a
repository fails. Read-only routes reach repositories through the per-tool
query facades in ``services/``; add domain logic there, not in the route.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2] / "app"

# Path relative to ``app/``. Closed by ARCH-LAYERS-002; do not add entries.
LEGACY_ROUTES: frozenset[str] = frozenset()


def route_modules() -> list[Path]:
    return sorted(
        path for path in APP_ROOT.rglob("*.py")
        if "api" in path.relative_to(APP_ROOT).parts and "routes" in path.relative_to(APP_ROOT).parts[:-1]
    )


def imports_repository(source: str) -> bool:
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom) and node.module and ".repositories" in node.module:
            return True
        if isinstance(node, ast.Import) and any(".repositories" in alias.name for alias in node.names):
            return True
    return False


def offenders() -> set[str]:
    return {
        path.relative_to(APP_ROOT).as_posix()
        for path in route_modules()
        if imports_repository(path.read_text(encoding="utf-8"))
    }


class RouteLayerRuleTests(unittest.TestCase):
    def test_route_modules_are_discovered(self) -> None:
        names = {path.name for path in route_modules()}
        # Guards the rule against silently scanning nothing after a refactor.
        self.assertIn("safe_write.py", names)
        self.assertIn("users.py", names)

    def test_no_new_route_imports_a_repository(self) -> None:
        new = sorted(offenders() - LEGACY_ROUTES)
        self.assertEqual(
            new, [],
            "Las rutas deben llamar a services/, no a repositories/ (ARCH-LAYERS-002):\n" + "\n".join(new),
        )

    def test_legacy_list_has_no_stale_entries(self) -> None:
        stale = sorted(LEGACY_ROUTES - offenders())
        self.assertEqual(stale, [], "Ya migradas; quitalas de LEGACY_ROUTES:\n" + "\n".join(stale))

    def test_every_route_imports_services_only(self) -> None:
        # The ratchet is closed: the legacy list must stay empty.
        self.assertEqual(LEGACY_ROUTES, frozenset())

    def test_detector_flags_repository_imports(self) -> None:
        self.assertTrue(imports_repository("from app.cyberark.pam.repositories.safes import x\n"))
        self.assertTrue(imports_repository("import app.cross.repositories.sync_queue\n"))
        self.assertFalse(imports_repository("from app.cyberark.pam.services.safe_classification import x\n"))


if __name__ == "__main__":
    unittest.main()
