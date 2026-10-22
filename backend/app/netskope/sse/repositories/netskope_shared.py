"""Shared constants and helpers for the Netskope query modules."""

import re

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_one
from app.netskope.sse.device_evidence import FUTURE_TOLERANCE_SECONDS, RECENT_DAYS, REVIEW_DAYS, SOURCE_FRESHNESS_HOURS


SOURCE_SYSTEM = "netskope"
MISSING_VALUE = "Sin dato"
# NSK-ALR-001: count-only alert snapshots are kept this many days. Readers that
# derive "first seen" from snapshots are bounded by it.
ALERT_AGGREGATE_RETENTION_DAYS = 180
# NSK-POL-002: marker dimension written when the policy dimension was captured.
POLICY_CAPTURE_MARKER = "policy_capture"
# Migration 060 forbids an empty dimension_value outside `total`.
POLICY_CAPTURE_MARKER_VALUE = "captured"


# Company is the first label of the identity's e-mail domain unless Netskope
# reports one explicitly. Metrics, facets and filters share these expressions
# so a chart bucket and the table filter it drills into always agree.
COMPANY_FROM_EMAIL = "upper(split_part(split_part(lower(coalesce(nullif(btrim(attributes->>'email'), ''), '')), '@', 2), '.', 1))"
COMPANY_FROM_DEVICE_USER = "upper(split_part(split_part(lower(coalesce(nullif(btrim(attributes->>'username'), ''), nullif(btrim(attributes->>'user_key'), ''), '')), '@', 2), '.', 1))"
# NSK-EXP-UCI-001: the user's UCI rating joined by the device's exact username. The table only lists users rated Poor or
# Moderate, so an absent user is "Sin alerta" only when a UCI capture exists at all; with no capture the value is NULL
# ("Sin dato"), never a fabricated clean bill.
UCI_RATING_SQL = (
    "CASE WHEN EXISTS (SELECT 1 FROM public.netskope_user_uci) THEN coalesce("
    "(SELECT u.rating FROM public.netskope_user_uci u WHERE u.email_key = lower(btrim(attributes->>'username'))), 'Sin alerta') END"
)
DEVICE_COMPANY = f"coalesce(nullif(attributes->>'company', ''), {COMPANY_FROM_DEVICE_USER})"
USER_COMPANY = f"coalesce(nullif(attributes->>'company', ''), {COMPANY_FROM_EMAIL})"

# Allowlist of device attributes the inventory can be filtered and faceted by.
# Keys are the public query parameter names; values are trusted SQL fragments.
DEVICE_FILTER_EXPRESSIONS = {
    "os": "attributes->>'os'",
    "client_version": "attributes->>'client_version'",
    "classification_status": "attributes->>'classification_status'",
    "user_status": "attributes->>'user_status'",
    "company": DEVICE_COMPANY,
    "last_seen_event": "attributes->>'last_seen_event'",
    "device_make": "attributes->>'device_make'",
    "device_model": "attributes->>'device_model'",
    # NSK-DUP-001 drills: exact hostname, username compared case-insensitively
    # (the same keys the duplicate groups use). Not offered as facets.
    "hostname": "attributes->>'hostname'",
    "username": "lower(attributes->>'username')",
    # NSK-EXP-ONPREM-001 drills (Netskope's On-Premises Detection and the client configuration applied).
    "onprem_status": "attributes->>'onprem_status'",
    "client_config": "attributes->>'client_config'",
    "uci_rating": UCI_RATING_SQL,
}
FACET_KEYS = ("os", "client_version", "classification_status", "user_status", "company", "last_seen_event", "device_make", "device_model", "onprem_status", "uci_rating")
FACET_LIMIT = 200

# NSK-EVT-001: exact `last_seen_event` literals observed in the tenant on
# 2026-09-23 that mean the client stopped protecting the device. Matching is
# by exact literal only; a new or differently worded value is shown in the
# distribution but never assumed to be a risk.
COVERAGE_RISK_EVENTS = ("Uninstalled", "Disconnected By Uninstall", "Admin Disabled")

# NSK-DEV-003: age of the client's last reported event. Confirmed against
# the tenant on 2026-09-23: `last_event_timestamp` is a JSON number in epoch
# seconds (10 digits), and its maximum matches the sync time. The bucket
# edges are named here and returned by the API so the UI shows them instead
# of hiding them in SQL. A non-numeric or missing value is "unknown", never
# the oldest bucket.
EVENT_AGE_BUCKETS = (
    ("lt_24h", "Menos de 24 h"),
    ("d1_7", "1 a 7 días"),
    ("d7_30", "7 a 30 días"),
    ("gt_30d", "Más de 30 días"),
    ("unknown", MISSING_VALUE),
)
# The 7- and 30-day cuts come from the evidence service, so the Python state, the SQL state,
# the freshness buckets, the stale metric and the filters can never disagree on a threshold.
EVENT_AGE_THRESHOLDS = {"recent_hours": 24, "week_days": RECENT_DAYS, "stale_days": REVIEW_DAYS}
DEVICE_FRESHNESS_DEFAULT = "recent"
DEVICE_FRESHNESS_VALUES = frozenset({"recent", "all"})

_RAW_EVENT_TIMESTAMP = "(attributes->>'last_event_timestamp')::numeric"


def valid_event_epoch(reference: str = "now()") -> str:
    """SQL for the last event's epoch, or NULL when the value cannot be trusted.

    A timestamp that is missing, not a JSON number, not positive or later than the
    reference plus FUTURE_TOLERANCE_SECONDS (heartbeats are stamped slightly ahead) is NULL: it classifies as unknown everywhere and never counts as
    recent or stale. The nested CASE guarantees the numeric cast only runs on numbers.
    """
    return (
        f"CASE WHEN jsonb_typeof(attributes->'last_event_timestamp') = 'number' THEN "
        f"CASE WHEN {_RAW_EVENT_TIMESTAMP} > 0 AND {_RAW_EVENT_TIMESTAMP} <= extract(epoch FROM {reference}) + {FUTURE_TOLERANCE_SECONDS} "
        f"THEN {_RAW_EVENT_TIMESTAMP} END END"
    )


def _epoch_before(reference: str, days: int) -> str:
    return f"extract(epoch FROM {reference} - make_interval(days => {days}))"


def recent_device_condition(reference: str = "now()") -> str:
    """Last event within week_days (the boundary itself is still recent)."""
    return f"{valid_event_epoch(reference)} >= {_epoch_before(reference, EVENT_AGE_THRESHOLDS['week_days'])}"


def stale_device_condition(reference: str = "now()") -> str:
    """Last event strictly older than stale_days (the boundary itself is not stale)."""
    return f"{valid_event_epoch(reference)} < {_epoch_before(reference, EVENT_AGE_THRESHOLDS['stale_days'])}"


RECENT_DEVICE_CONDITION = recent_device_condition()
STALE_DEVICE_CONDITION = stale_device_condition()

# The newest client-inventory run controls freshness, not the last successful
# run nor last_seen_at (which is merely the time Custodia synced a record).
SOURCE_EVIDENCE_CTES = f"""
    latest_source AS (
      SELECT status AS source_status, completed_at AS source_completed_at
      FROM public.cyberark_ingestion_runs
      WHERE source_system = 'netskope' AND source_file = 'netskope-api'
      ORDER BY started_at DESC, run_id DESC LIMIT 1
    ), source_evidence AS (
      SELECT statement_timestamp() AS evidence_as_of,
             (SELECT source_status FROM latest_source) AS source_status,
             (SELECT source_completed_at FROM latest_source) AS source_completed_at,
             coalesce((SELECT source_status = 'completed'
               AND source_completed_at BETWEEN statement_timestamp() - interval '{SOURCE_FRESHNESS_HOURS} hours'
                                           AND statement_timestamp()
               FROM latest_source), false) AS source_fresh
    )
"""


async def get_netskope_source_evidence(pool: AsyncConnectionPool) -> dict:
    """Whether the newest Netskope run is a complete, recent one (never inferred from the data)."""
    row = await fetch_one(pool, f"WITH {SOURCE_EVIDENCE_CTES} SELECT evidence_as_of AS as_of, source_status, source_completed_at, source_fresh FROM source_evidence")
    return {
        "source_fresh": bool(row["source_fresh"]), "source_status": row["source_status"],
        "source_completed_at": row["source_completed_at"], "as_of": row["as_of"],
    } if row else {"source_fresh": False, "source_status": None, "source_completed_at": None, "as_of": None}


def device_evidence_state_sql(reference: str = "statement_timestamp()") -> str:
    """The same four states as device_evidence.device_evidence."""
    event = valid_event_epoch(reference)
    return f"""CASE
    WHEN NOT (SELECT source_fresh FROM source_evidence) THEN 'unknown'
    WHEN ({event}) IS NULL THEN 'unknown'
    WHEN {recent_device_condition(reference)} THEN 'recent'
    WHEN {stale_device_condition(reference)} THEN 'review'
    ELSE 'not_recent' END"""


def _event_age_case(reference: str) -> str:
    event = valid_event_epoch(reference)
    return f"""CASE
        WHEN ({event}) IS NULL THEN 'unknown'
        WHEN {event} >= extract(epoch FROM {reference} - make_interval(hours => {EVENT_AGE_THRESHOLDS["recent_hours"]})) THEN 'lt_24h'
        WHEN {event} >= {_epoch_before(reference, EVENT_AGE_THRESHOLDS["week_days"])} THEN 'd1_7'
        WHEN {event} >= {_epoch_before(reference, EVENT_AGE_THRESHOLDS["stale_days"])} THEN 'd7_30'
        ELSE 'gt_30d'
    END"""


def _bucket(expression: str) -> str:
    return f"coalesce(nullif(btrim({expression}), ''), '{MISSING_VALUE}')"


# NSK-XMET-001: aggregate form of the NSK-DEV-001 observed-user match. A
# device's normalized username (lower(btrim)) matches exactly one active
# user when it equals that user's normalized source_id or email; two or more
# distinct candidate users are ambiguous and none is unmatched. The CTE
# preamble is shared by the cross metrics and the user inventory filters so
# both compute the same relation instead of re-implementing the predicate.
# Callers pass their own ``%s`` clauses and params, which are interleaved as
# [SOURCE_SYSTEM, *user_params, SOURCE_SYSTEM, *device_params].
def observed_user_match_ctes(
    *,
    user_clauses: str = "",
    user_params: tuple = (),
    device_scope: str = "",
    device_clauses: str = "",
    device_params: tuple = (),
) -> tuple[str, list]:
    sql = f"""
        active_users AS (
            SELECT object_id, source_id, display_name, attributes->>'email' AS email
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'user' AND lifecycle_status = 'active'{user_clauses}
        ),
        user_keys AS MATERIALIZED (
            SELECT key, count(DISTINCT object_id)::int AS candidates, min(object_id) AS user_object_id
            FROM (
                SELECT object_id, lower(btrim(coalesce(source_id, ''))) AS key FROM active_users
                UNION ALL
                SELECT object_id, lower(btrim(coalesce(email, ''))) AS key FROM active_users
            ) AS keys
            WHERE key <> ''
            GROUP BY key
        ),
        scoped_devices AS MATERIALIZED (
            SELECT object_id, attributes,
                   lower(btrim(coalesce(attributes->>'username', ''))) AS match_key,
                   to_timestamp(({valid_event_epoch()})::double precision) AS event_time
            FROM public.cyberark_inventory_objects
            WHERE source_system = %s AND object_type = 'device' AND lifecycle_status = 'active'{device_scope}{device_clauses}
        ),
        matched_devices AS MATERIALIZED (
            SELECT devices.object_id, keys.user_object_id, devices.event_time, devices.attributes, devices.match_key
            FROM scoped_devices devices
            JOIN user_keys keys ON keys.key = devices.match_key AND keys.candidates = 1
        )
    """
    return sql, [SOURCE_SYSTEM, *user_params, SOURCE_SYSTEM, *device_params]



# NSK-CHG-001 / NSK-VER-001: numeric dotted prefix of a client version
# compared segment by segment as numeric[] ("141.0.0.2792 (64-bit)" and
# "141.0.0.2792" are the same version; "9" < "10"). NULL when the value has
# no numeric prefix, which callers treat as "not comparable", never as old.
def _numeric_version(expression: str) -> str:
    return f"string_to_array((regexp_match({expression}, '^\\s*(\\d+(?:\\.\\d+)*)'))[1], '.')::numeric[]"


def _version_key(attributes: str) -> str:
    return _numeric_version(f"{attributes}->>'client_version'")


def parse_version(value: str) -> list[int] | None:
    """Python twin of _numeric_version, used to validate admin input.

    ``re.ASCII`` keeps ``\\d``/``\\s`` on the same ASCII classes the twin's
    ``regexp_match`` uses, so a Unicode-digit version ("٣.٤", "1２") is not
    silently parsed to a different number in Python. A digit run past
    CPython's int-conversion limit is "not comparable" (``None``) instead of
    an exception; the only caller caps input at 40 characters.
    """
    match = re.match(r"^\s*(\d+(?:\.\d+)*)", value or "", re.ASCII)
    if match is None:
        return None
    try:
        return [int(part) for part in match.group(1).split(".")]
    except ValueError:
        return None


async def _baseline_value(pool: AsyncConnectionPool, key: str):
    row = await fetch_one(pool, "SELECT value, note, updated_by, updated_at FROM public.netskope_baselines WHERE baseline_key = %s", (key,))
    return row
