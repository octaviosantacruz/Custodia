import ast
import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]
AUTHENTICATION_DOC = ROOT / "docs" / "operations" / "authentication.md"


class _Matrix:
    """The permission matrix is the last section of the authentication guide."""

    @staticmethod
    def read_text() -> str:
        text = AUTHENTICATION_DOC.read_text()
        return text[text.index("## Matriz de permisos administrativos"):]


MATRIX = _Matrix()
MIGRATION = ROOT / "migrations" / "068_access_admin_permissions.sql"
ROUTE_FILES = (
    ROOT / "backend" / "app" / "cross/api/routes/access_control.py",
    ROOT / "backend" / "app" / "cross/api/routes/users.py",
    ROOT / "backend" / "app" / "cross/api/routes/activity.py",
    ROOT / "backend" / "app" / "cross/api/routes/operational_errors.py",
    ROOT / "backend" / "app" / "cross/api/routes/security_events.py",
    ROOT / "backend" / "app" / "cross/api/routes/ingestion.py",
)


def _router_prefix(tree: ast.Module) -> str:
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == "router" for target in node.targets):
            continue
        if isinstance(node.value, ast.Call):
            for keyword in node.value.keywords:
                if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant):
                    return str(keyword.value.value)
    return ""


def _managed_routes(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    prefix = _router_prefix(tree)
    routes: set[str] = set()
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if "access:manage" not in {value.value for value in ast.walk(node) if isinstance(value, ast.Constant)}:
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                continue
            if not isinstance(decorator.func.value, ast.Name) or decorator.func.value.id != "router":
                continue
            method = decorator.func.attr.upper()
            if method not in {"GET", "POST", "PATCH", "PUT", "DELETE"} or not decorator.args:
                continue
            route = decorator.args[0]
            if isinstance(route, ast.Constant) and isinstance(route.value, str):
                routes.add(f"{method} {prefix}{route.value}")
    return routes


class AccessPermissionMatrixTests(unittest.TestCase):
    def test_every_access_manage_admin_route_is_in_the_versioned_matrix(self):
        documented = set(re.findall(r"`(GET|POST|PATCH|PUT|DELETE) ([^`]+)`", MATRIX.read_text()))
        documented_routes = {f"{method} {path}" for method, path in documented}
        source_routes = set().union(*(_managed_routes(path) for path in ROUTE_FILES))
        self.assertEqual(source_routes, documented_routes)

    def test_matrix_names_every_approved_narrow_permission(self):
        body = MATRIX.read_text()
        for permission in (
            "access:directory_read",
            "access:local_users_manage",
            "access:role_assignments_manage",
            "access:roles_read",
            "access:roles_manage",
            "access:permissions_manage",
            "access:oidc_mappings_read",
            "audit:read",
            "security:events_read",
        ):
            self.assertIn(f"`{permission}`", body)

    def test_additive_migration_seeds_permissions_without_granting_roles(self):
        body = MIGRATION.read_text()
        for permission in (
            "access:directory_read",
            "access:local_users_manage",
            "access:role_assignments_manage",
            "access:roles_read",
            "access:roles_manage",
            "access:permissions_manage",
            "access:oidc_mappings_read",
            "audit:read",
            "security:events_read",
        ):
            self.assertIn(f"'{permission}'", body)
        self.assertNotIn("INSERT INTO public.access_role_permissions", body)


if __name__ == "__main__":
    unittest.main()
