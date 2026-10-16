import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.cross.api.routes.search import router as search_router, search
from app.auth import require_read_access
from app.cross.repositories.search import ROWS_PER_GROUP, search_inventory


class SearchRouteTests(unittest.TestCase):
    def test_route_requires_read_access(self):
        route = next(route for route in search_router.routes if route.path == "/api/search")
        self.assertIn(require_read_access, [dependency.dependency for dependency in route.dependencies])

    def test_trims_query_and_delegates_include_internal(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))
        expected = {"query": "finance", "groups": {}}
        with patch("app.cross.api.routes.search.search_inventory", new=AsyncMock(return_value=expected)) as repository:
            result = asyncio.run(search(request, "  finance  ", False))

        self.assertEqual(result, expected)
        repository.assert_awaited_once_with(request.app.state.db, "finance", include_internal=False)

    def test_rejects_a_trimmed_query_shorter_than_two_characters(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with self.assertRaises(HTTPException) as error:
            asyncio.run(search(request, "  x  "))
        self.assertEqual(error.exception.status_code, 422)
        self.assertIn("2 caracteres", error.exception.detail)


class SearchRepositoryTests(unittest.TestCase):
    def test_returns_minimal_grouped_navigable_results(self):
        query_rows = [
            [{"target": 1, "label": "Finance", "detail": "Root"}],
            [{"target": 1, "label": "svc-finance", "detail": "Safe: Finance"}],
            [{"target": 3, "label": "ada", "detail": "PAM user"}],
            [{"target": 4, "label": "Finance operators", "detail": "PAM role"}],
            [{"target": 5, "label": "Finance access", "detail": "active"}],
            [{"target": 6, "label": "Ada Lovelace", "detail": "ada@example.test"}],
            [{"target": 7, "label": "Identity operators", "detail": "Identity Administration role"}],
            [{"target": 8, "label": "db-finance-01", "detail": "10.0.0.1 · PROD"}],
        ]
        with patch("app.cross.repositories.search.fetch_all", new=AsyncMock(side_effect=query_rows)) as fetch_all:
            result = asyncio.run(search_inventory(object(), "finance", include_internal=False))

        self.assertEqual(result["query"], "finance")
        self.assertEqual(set(result["groups"]), {
            "safes", "accounts", "pam_users", "pam_roles", "sia_policies",
            "identity_users", "identity_roles", "connections",
        })
        account = result["groups"]["accounts"][0]
        self.assertEqual(account, {
            "type": "account", "label": "svc-finance", "detail": "Safe: Finance",
            "workspace": "safes", "target": 1, "query": "finance",
        })
        self.assertEqual(fetch_all.await_count, 8)
        for call in fetch_all.await_args_list:
            sql, params = call.args[1:]
            self.assertIn("%s", sql)
            self.assertIn("finance", [value.strip("%") if isinstance(value, str) else value for value in params])
            self.assertEqual(params[-1], ROWS_PER_GROUP)
            self.assertNotIn("password", sql.lower())
            self.assertNotIn("secret", sql.lower())
            self.assertNotIn("raw_payload", sql.lower())

        safe_sql = fetch_all.await_args_list[0].args[1]
        account_sql = fetch_all.await_args_list[1].args[1]
        pam_user_sql = fetch_all.await_args_list[2].args[1]
        self.assertIn("meta.inventory_scope", safe_sql)
        self.assertIn("a.inventory_account_type", account_sql)
        self.assertIn("user_has_role", pam_user_sql)
        self.assertNotIn("psm", "\n".join(call.args[1].lower() for call in fetch_all.await_args_list))

    def test_does_not_expose_source_attribute_documents(self):
        with patch("app.cross.repositories.search.fetch_all", new=AsyncMock(return_value=[])):
            result = asyncio.run(search_inventory(object(), "finance"))

        for group in result["groups"].values():
            for row in group:
                self.assertEqual(set(row), {"type", "label", "detail", "workspace", "target", "query"})


if __name__ == "__main__":
    unittest.main()
