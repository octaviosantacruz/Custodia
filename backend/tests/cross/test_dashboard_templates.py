import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.dashboard_templates import publish_dashboard_template


class _Context:
    def __init__(self, value): self.value = value
    async def __aenter__(self): return self.value
    async def __aexit__(self, *_): return False


class _Cursor:
    def __init__(self):
        self.calls = []
        self.rows = [
            {"display_name": "Operaciones Netskope"},
            {"version": 3},
            {"role_code": "netskope_ops", "version": 3, "widgets": [{"id": "users_total"}], "published_at": None},
        ]
    async def execute(self, query, params=()): self.calls.append((query, params))
    async def fetchone(self): return self.rows.pop(0)


class _Connection:
    def __init__(self): self.cursor_instance = _Cursor()
    def transaction(self): return _Context(self)
    def cursor(self): return _Context(self.cursor_instance)


class _Pool:
    def __init__(self): self.connection_instance = _Connection()
    def connection(self): return _Context(self.connection_instance)


class DashboardTemplateTests(unittest.TestCase):
    def test_publish_appends_a_version_and_audits_in_the_same_transaction(self):
        pool = _Pool()
        widgets = [{"id": "users_total"}]
        with patch("app.cross.repositories.dashboard_templates.record_audit", new=AsyncMock()) as audit:
            saved = asyncio.run(publish_dashboard_template(pool, "admin-1", "netskope_ops", "netskope", widgets))

        self.assertEqual(saved["version"], 3)
        queries = [query for query, _params in pool.connection_instance.cursor_instance.calls]
        self.assertIn("FOR UPDATE", queries[0])
        self.assertIn("MAX(version)", queries[1])
        self.assertIn("INSERT INTO public.role_dashboard_templates", queries[2])
        self.assertIs(audit.await_args.kwargs["connection"], pool.connection_instance)
        self.assertEqual(audit.await_args.kwargs["action"], "publish")
        self.assertEqual(audit.await_args.kwargs["entity_id"], "netskope:netskope_ops:3")


if __name__ == "__main__":
    unittest.main()
