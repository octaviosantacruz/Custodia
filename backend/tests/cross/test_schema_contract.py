import asyncio
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.schema import REQUIRED_SCHEMA_COLUMNS, REQUIRED_SCHEMA_TABLES, SchemaNotReadyError, assert_schema_ready


ROOT = Path(__file__).resolve().parents[3]


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

    def test_netskope_dashboard_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.user_netskope_dashboard_preferences", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/054_netskope_dashboard_preferences.sql").read_text(encoding="utf-8")
        baseline = (ROOT / "migrations/baseline.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE public.user_netskope_dashboard_preferences", migration)
        self.assertIn("CREATE TABLE public.user_netskope_dashboard_preferences", baseline)

    def test_netskope_baselines_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.netskope_baselines", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/059_netskope_baselines.sql").read_text(encoding="utf-8")
        baseline = (ROOT / "migrations/baseline.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE public.netskope_baselines", migration)
        self.assertIn("CREATE TABLE public.netskope_baselines", baseline)

    def test_operational_error_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.operational_error_events", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/055_operational_error_events.sql").read_text(encoding="utf-8")
        baseline = (ROOT / "migrations/baseline.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE public.operational_error_events", migration)
        self.assertIn("CREATE TABLE public.operational_error_events", baseline)

    def test_activity_events_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.activity_events", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/034_activity_events.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS public.activity_events", migration)

    def test_operational_logs_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.operational_log_events", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/056_operational_log_events.sql").read_text(encoding="utf-8")
        baseline = (ROOT / "migrations/baseline.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE public.operational_log_events", migration)
        self.assertIn("CREATE TABLE public.operational_log_events", baseline)

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

    def test_activity_event_sync_identity_is_part_of_the_runtime_schema_contract(self):
        required = {
            ("public.activity_events", "run_id"),
            ("public.activity_events", "source_system"),
        }
        self.assertTrue(required.issubset(REQUIRED_SCHEMA_COLUMNS))
        migration = (ROOT / "migrations/057_activity_events_sync_identity.sql").read_text(encoding="utf-8")
        self.assertIn("ADD COLUMN IF NOT EXISTS run_id", migration)
        self.assertIn("ADD COLUMN IF NOT EXISTS source_system", migration)

    def test_shared_rate_limit_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.rate_limit_attempts", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/046_rate_limit_attempts.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS public.rate_limit_attempts", migration)

    def test_api_tokens_table_is_part_of_the_schema_contract(self):
        self.assertIn("public.access_api_tokens", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/049_read_only_api_tokens.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS public.access_api_tokens", migration)
        self.assertIn("token_hash", migration)

    def test_oidc_directory_table_is_required_before_serving_logins(self):
        self.assertIn("public.access_oidc_users", REQUIRED_SCHEMA_TABLES)
        migration = (ROOT / "migrations/050_oidc_user_directory.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE public.access_oidc_users", migration)

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

    def test_runtime_schema_check_rejects_missing_activity_event_sync_identity(self):
        missing = [
            {"table_name": "public.activity_events", "column_name": "run_id"},
            {"table_name": "public.activity_events", "column_name": "source_system"},
        ]
        with patch("app.schema.fetch_all", new=AsyncMock(side_effect=[[], missing])):
            with self.assertRaisesRegex(
                SchemaNotReadyError,
                "public.activity_events.run_id, public.activity_events.source_system",
            ):
                asyncio.run(assert_schema_ready(object()))


if __name__ == "__main__":
    unittest.main()
