"""ACCESS-AUDIT-EXPORT-001 against real PostgreSQL: the audited, filtered, formula-safe export of Actividad."""

import csv
import io
from uuid import uuid4

from app.cross.repositories.audit import record_audit
from app.cross.services.audit_trail import export_activity_csv
from tests.support.pg_integration_base import PostgresIntegrationTestCase


class ActivityExportPostgresTests(PostgresIntegrationTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tag = f"exp-{uuid4().hex[:8]}"
        self.addAsyncCleanup(self._cleanup)
        await record_audit(self.pool, actor_id="=HYPERLINK(\"x\")", action="update", entity_type=self.tag, entity_id=f"{self.tag}-a",
                           after_data={"note": "=1+1", "password_hash": "never"})
        await record_audit(self.pool, actor_id="tester", action="create", entity_type=self.tag, entity_id=f"{self.tag}-b")
        await record_audit(self.pool, actor_id="tester", action="update", entity_type="other_" + self.tag, entity_id=f"{self.tag}-c")

    async def _cleanup(self):
        async with self.pool.connection() as conn:
            await conn.execute("DELETE FROM public.access_audit_log WHERE entity_type LIKE %s OR entity_type LIKE %s", (self.tag, "%" + self.tag))

    async def export(self, **filters) -> list[dict]:
        content = await export_activity_csv(self.pool, "exporter", **filters)
        return list(csv.DictReader(io.StringIO(content)))

    async def test_the_filters_of_the_view_narrow_the_export(self):
        self.assertEqual(len(await self.export(entity_type=self.tag)), 2)
        rows = await self.export(entity_type=self.tag, action="create")
        self.assertEqual([row["ID de entidad"] for row in rows], [f"{self.tag}-b"])
        self.assertEqual(len(await self.export(q=f"{self.tag}-c")), 1)

    async def test_formula_cells_are_neutralized_and_secrets_never_leave(self):
        rows = await self.export(entity_type=self.tag, action="update")
        self.assertEqual(rows[0]["Actor ID"], "'=HYPERLINK(\"x\")")
        self.assertIn("=1+1", rows[0]["Después"])
        self.assertTrue(rows[0]["Después"].startswith("'") is False, "JSON cells start with a brace, not a formula")
        self.assertNotIn("password_hash", rows[0]["Después"])

    async def test_the_export_itself_is_audited_with_its_filters(self):
        await self.export(entity_type=self.tag, action="create")
        async with self.pool.connection() as conn:
            cursor = await conn.execute(
                "SELECT after_data FROM public.access_audit_log WHERE actor_id = 'exporter' AND entity_type = 'activity_log' ORDER BY audit_id DESC LIMIT 1"
            )
            after = (await cursor.fetchone())["after_data"]
            await conn.execute("DELETE FROM public.access_audit_log WHERE actor_id = 'exporter' AND entity_type = 'activity_log'")
        self.assertEqual(after["row_count"], 1)
        self.assertEqual(after["filters"], {"action": "create", "entity_type": self.tag})
        self.assertFalse(after["truncated"])
