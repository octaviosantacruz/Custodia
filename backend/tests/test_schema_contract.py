import asyncio
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.schema import REQUIRED_SCHEMA_COLUMNS, REQUIRED_SCHEMA_TABLES, SchemaNotReadyError, assert_schema_ready


ROOT = Path(__file__).resolve().parents[2]


class SchemaContractTests(unittest.TestCase):
    def test_findings_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.cyberark_findings", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/026_findings_engine.sql").read_text(encoding="utf-8")
        baseline = (ROOT / "migrations/baseline.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS public.cyberark_findings", migration)
        self.assertIn("CREATE TABLE IF NOT EXISTS public.cyberark_findings", baseline)

    def test_personal_dashboard_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.user_dashboard_preferences", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/029_user_dashboard_preferences.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE public.user_dashboard_preferences", migration)

    def test_activity_events_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.activity_events", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/034_activity_events.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS public.activity_events", migration)

    def test_ingestion_runs_allow_the_access_source_system(self):
        """ACCESS-001 enqueue writes source_system='access'; 025's CHECK
        only listed cyberark/identity_administration/sia and blocked sync-all."""
        migration = (ROOT / "migrations/042_access_source_on_ingestion_runs.sql").read_text(encoding="utf-8")
        self.assertIn("cyberark_ingestion_runs_source_system_check", migration)
        self.assertIn("'access'", migration)
        self.assertIn("cyberark_findings_source_system_check", migration)

    def test_deployment_documents_the_migration_gate(self):
        deployment = (ROOT / "docs/operations/deployment.md").read_text(encoding="utf-8")
        self.assertIn("paso controlado del despliegue", deployment)
        self.assertIn("tablas requeridas", deployment)

    def test_session_version_is_part_of_the_runtime_schema_contract(self):
        self.assertIn(("public.access_users", "session_version"), REQUIRED_SCHEMA_COLUMNS)
        migration = (ROOT / "migrations/045_session_version.sql").read_text(encoding="utf-8")
        self.assertIn("session_version", migration)

    def test_shared_rate_limit_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.rate_limit_attempts", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/046_rate_limit_attempts.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS public.rate_limit_attempts", migration)

    def test_rate_limit_retention_index_exists_for_the_scheduled_purge(self):
        """IF-001: purge_expired_attempts() filters by window_started_at on
        a table fed by unauthenticated traffic -- without an index this
        scheduled query degrades to a full scan as the table grows."""
        migration = (ROOT / "migrations/047_rate_limit_attempts_retention_index.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE INDEX IF NOT EXISTS idx_rate_limit_attempts_window_started_at", migration)
        self.assertIn("public.rate_limit_attempts (window_started_at)", migration)

    def test_runtime_schema_check_rejects_a_missing_session_version_column(self):
        with patch(
            "app.schema.fetch_all",
            new=AsyncMock(side_effect=[[], [{"table_name": "public.access_users", "column_name": "session_version"}]]),
        ):
            with self.assertRaisesRegex(SchemaNotReadyError, "public.access_users.session_version"):
                asyncio.run(assert_schema_ready(object()))


if __name__ == "__main__":
    unittest.main()
