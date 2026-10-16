"""ARCH-LAYERS-001: services never talk to PostgreSQL.

Routes (Controller) -> services -> repositories own the SQL, integrations own
external HTTP. A module under ``services/`` must not execute SQL, import the
``app.db`` query helpers or embed SQL statements; that belongs in the owning
tool's ``repositories/``.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2] / "app"

QUERY_CALLS = {"execute", "executemany", "fetch_all", "fetch_one", "fetch_val"}
DB_HELPERS = {"fetch_all", "fetch_one", "fetch_val"}
SQL_STATEMENT = re.compile(
    r"\b(SELECT\b[\s\S]+?\bFROM\b|INSERT\s+INTO\b|UPDATE\s+[\w.]+\s+SET\b|DELETE\s+FROM\b)",
    re.IGNORECASE,
)

# Explicit, justified exceptions: path relative to ``app/`` -> reason.
ALLOWED_QUERY_CALLS = {
    "cross/services/database_credentials.py": (
        "connection probe (`SELECT 1`) used to validate a credential; it reads no data"
    ),
}


def service_modules() -> list[Path]:
    return sorted(
        path for path in APP_ROOT.rglob("*.py")
        if "services" in path.relative_to(APP_ROOT).parts[:-1]
    )


def _call_name(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    if isinstance(node.func, ast.Name):
        return node.func.id
    return None


def violations(path: Path) -> list[str]:
    relative = path.relative_to(APP_ROOT).as_posix()
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=relative)
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _call_name(node) in QUERY_CALLS and relative not in ALLOWED_QUERY_CALLS:
            found.append(f"{relative}:{node.lineno} llama a {_call_name(node)}()")
        elif isinstance(node, ast.ImportFrom) and node.module == "app.db":
            names = {alias.name for alias in node.names} & DB_HELPERS
            if names:
                found.append(f"{relative}:{node.lineno} importa {', '.join(sorted(names))} de app.db")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and relative not in ALLOWED_QUERY_CALLS:
            if SQL_STATEMENT.search(node.value) and "public." in node.value:
                found.append(f"{relative}:{node.lineno} contiene una sentencia SQL")
    return found


class ServiceLayerSqlRuleTests(unittest.TestCase):
    def test_services_directories_are_discovered(self) -> None:
        names = {path.name for path in service_modules()}
        # Guards the rule against silently scanning nothing after a refactor.
        self.assertIn("pam_accounts.py", names)
        self.assertIn("dashboard_widgets.py", names)

    def test_no_service_executes_or_embeds_sql(self) -> None:
        found = [item for path in service_modules() for item in violations(path)]
        self.assertEqual(
            found, [],
            "Mové el SQL a repositories/ (ARCH-LAYERS-001):\n" + "\n".join(found),
        )

    def test_allowed_exceptions_still_exist(self) -> None:
        for relative in ALLOWED_QUERY_CALLS:
            self.assertTrue((APP_ROOT / relative).exists(), f"excepción obsoleta: {relative}")

    def test_rule_detects_each_kind_of_leak(self) -> None:
        samples = {
            "execute": "async def f(c):\n    await c.execute('x')\n",
            "fetch helper call": "async def f(p):\n    return await fetch_all(p, 'x')\n",
            "app.db import": "from app.db import fetch_one\n",
            "embedded SQL": "Q = 'SELECT a FROM public.t'\n",
        }
        for label, source in samples.items():
            with self.subTest(label):
                tree = ast.parse(source)
                hits = 0
                for node in ast.walk(tree):
                    if isinstance(node, ast.Call) and _call_name(node) in QUERY_CALLS:
                        hits += 1
                    elif isinstance(node, ast.ImportFrom) and node.module == "app.db":
                        hits += bool({alias.name for alias in node.names} & DB_HELPERS)
                    elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                        hits += bool(SQL_STATEMENT.search(node.value) and "public." in node.value)
                self.assertGreaterEqual(hits, 1)


if __name__ == "__main__":
    unittest.main()
