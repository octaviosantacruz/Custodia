"""Runtime checks for the database schema required by the API."""
from __future__ import annotations

from app.db import fetch_all


# Keep this list deliberately small and focused on tables that are required for
# the API to serve requests. The migration runner remains the source of truth
# for creating and evolving the schema.
REQUIRED_SCHEMA_TABLES = (
    "public.access_users",
    "public.access_oidc_users",
    "public.safes",
    "public.safe_members",
    "public.cyberark_ingestion_runs",
    "public.sync_schedule_overrides",
    "public.access_user_roles",
    "public.access_oidc_group_roles",
    "public.access_oidc_mapping_state",
    "public.access_permissions",
    "public.access_domains",
    "public.access_domain_levels",
    "public.access_custom_role_levels",
    "public.cyberark_findings",
    "public.user_dashboard_preferences",
    "public.user_netskope_dashboard_preferences",
    "public.role_dashboard_templates",
    "public.connection_inventory_imports",
    "public.connection_inventory",
    "public.sia_policy_capabilities",
    "public.connection_coverage_snapshots",
    "public.activity_events",
    "public.rate_limit_attempts",
    "public.access_security_events",
    "public.access_api_tokens",
    "public.operational_error_events",
    "public.operational_log_events",
    "public.netskope_baselines",
    "public.netskope_device_reviews",
    "public.netskope_reported_counts",
    "public.netskope_alert_aggregates",
    "public.netskope_dlp_event_cache",
    "public.netskope_dlp_cache_state",
    "public.netskope_dlp_alerts",
    "public.netskope_dlp_capture_state",
)

# Columns introduced by security-sensitive migrations that the application
# cannot safely operate without. Checking tables alone would let an instance
# start after a partial upgrade and fail only when the first login queries the
# missing session_version column.
REQUIRED_SCHEMA_COLUMNS = (
    ("public.access_users", "session_version"),
    # Activity events drive cross-session refreshes. Their sync identity must
    # be present at startup so a missed migration cannot degrade polling into
    # a silent background failure after the API begins serving requests.
    ("public.activity_events", "run_id"),
    ("public.activity_events", "source_system"),
)


class SchemaNotReadyError(RuntimeError):
    """Raised when the database is reachable but migrations are incomplete."""


async def assert_schema_ready(pool) -> None:
    """Ensure every table required by the running API exists.

    This is a fail-fast guard for deployments that start the API without first
    running the migration runner. It does not mutate the database.
    """

    rows = await fetch_all(
        pool,
        """
        SELECT required.name
        FROM unnest(%s::text[]) AS required(name)
        WHERE to_regclass(required.name) IS NULL
        ORDER BY required.name
        """,
        (list(REQUIRED_SCHEMA_TABLES),),
    )
    missing = [row["name"] for row in rows]
    if missing:
        missing_tables = ", ".join(missing)
        raise SchemaNotReadyError(
            "Faltan migraciones de base de datos: "
            f"{missing_tables}. Ejecutá scripts/migrate.sh antes de iniciar Custodia."
        )

    rows = await fetch_all(
        pool,
        """
        SELECT required.table_name, required.column_name
        FROM unnest(%s::text[], %s::text[])
          AS required(table_name, column_name)
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_attribute attribute
          WHERE attribute.attrelid = to_regclass(required.table_name)
            AND attribute.attname = required.column_name
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
        )
        ORDER BY required.table_name, required.column_name
        """,
        (
            [table for table, _column in REQUIRED_SCHEMA_COLUMNS],
            [column for _table, column in REQUIRED_SCHEMA_COLUMNS],
        ),
    )
    missing_columns = [f"{row['table_name']}.{row['column_name']}" for row in rows]
    if missing_columns:
        raise SchemaNotReadyError(
            "Faltan migraciones de base de datos: columnas requeridas "
            f"{', '.join(missing_columns)}. Ejecutá scripts/migrate.sh antes de iniciar Custodia."
        )
