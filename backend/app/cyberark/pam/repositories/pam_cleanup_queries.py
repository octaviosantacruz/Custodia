"""Read-only cleanup signals derived from the normalized PAM inventory."""

from psycopg_pool import AsyncConnectionPool

from app.db import fetch_all

PAM_SOURCE_SYSTEM = "cyberark"

# Names explicitly identified as factory groups by the PAM-GRP-001 evidence.
# Keep this allowlist narrow: an unfamiliar name is not enough to classify a
# group as factory-managed.
FACTORY_GROUP_LABELS = {
    "PSMMaster": "Grupo de fábrica CyberArk · PSM",
    "PSMLiveSessionTerminators": "Grupo de fábrica CyberArk · terminadores de sesión",
}

GROUP_SIGNALS = frozenset({"empty_groups", "identical_member_groups", "redundant_groups_with_access_peer"})


_CLEANUP_SIGNALS_SQL = """
WITH run_families AS (
  SELECT 'pam_inventory'::text AS family
  UNION ALL SELECT 'psm_catalog'
), pertinent_runs AS (
  SELECT run.*, CASE WHEN source_file = 'cyberark-api' THEN 'pam_inventory'
                    ELSE 'psm_catalog' END AS family,
         (status = 'completed' AND completed_at IS NOT NULL
          AND (source_file = 'cyberark-psm-api' OR pam_synced)) AS inventory_refreshed
  FROM public.cyberark_ingestion_runs run
  WHERE source_system = 'cyberark'
    AND ((source_file = 'cyberark-api' AND run_options->>'psm_only' IS DISTINCT FROM 'true')
      OR (source_file = 'cyberark-psm-api' AND run_options->>'psm_only' = 'true'))
), run_evidence AS (
  -- Run history is source evidence, not a historical snapshot of each row.
  SELECT family.family,
         (SELECT jsonb_build_object(
           'run_id', r.run_id, 'source_system', r.source_system, 'source_file', r.source_file,
           'status', r.status, 'enqueued_at', r.enqueued_at, 'started_at', r.started_at,
           'completed_at', r.completed_at, 'inventory_refreshed', r.inventory_refreshed)
          FROM pertinent_runs r WHERE r.family = family.family
          ORDER BY r.enqueued_at DESC, r.started_at DESC, r.run_id DESC LIMIT 1) AS latest_attempt,
         (SELECT jsonb_build_object(
           'run_id', r.run_id, 'source_system', r.source_system, 'source_file', r.source_file,
           'status', r.status, 'enqueued_at', r.enqueued_at, 'started_at', r.started_at,
           'completed_at', r.completed_at, 'inventory_refreshed', r.inventory_refreshed)
          FROM pertinent_runs r WHERE r.family = family.family AND r.inventory_refreshed
          ORDER BY r.completed_at DESC, r.enqueued_at DESC, r.run_id DESC LIMIT 1) AS last_completed_inventory
  FROM run_families family
), active_objects AS (
  -- "Activo" here is strictly the normalized lifecycle status; user enabled/
  -- suspended attributes are not substituted for lifecycle evidence.
  SELECT object_id, object_type, source_id, display_name, attributes
  FROM public.cyberark_inventory_objects
  WHERE source_system = %s AND lifecycle_status = 'active'
),
active_relationships AS (
  SELECT relation.relationship_type, relation.source_object_id, relation.target_object_id
  FROM public.cyberark_inventory_relationships relation
  JOIN active_objects source_object ON source_object.object_id = relation.source_object_id
  JOIN active_objects target_object ON target_object.object_id = relation.target_object_id
  WHERE relation.lifecycle_status = 'active'
    AND relation.relationship_type IN (
      'user_has_role', 'role_grants_access', 'platform_uses_psm'
    )
),
users AS (
  SELECT object_id FROM active_objects WHERE object_type = 'user'
),
roles AS (
  SELECT object_id, source_id, display_name FROM active_objects WHERE object_type = 'role'
),
safes AS (
  SELECT object_id, source_id, display_name FROM active_objects WHERE object_type = 'safe'
),
platforms AS (
  SELECT object_id, source_id, display_name FROM active_objects WHERE object_type = 'platform'
),
psms AS (
  SELECT object_id, source_id, display_name FROM active_objects WHERE object_type = 'psm'
),
role_members AS (
  -- Exact membership identity is the sorted set of active PAM user object IDs,
  -- never display names/source-name similarity; empty arrays are excluded below.
  SELECT role.object_id, role.source_id, role.display_name,
         count(DISTINCT pam_user.object_id)::int AS member_count,
         coalesce(
           array_agg(DISTINCT pam_user.object_id ORDER BY pam_user.object_id)
             FILTER (WHERE pam_user.object_id IS NOT NULL),
           ARRAY[]::bigint[]
         ) AS member_ids
  FROM roles role
  LEFT JOIN active_relationships membership
    ON membership.target_object_id = role.object_id
   AND membership.relationship_type = 'user_has_role'
  LEFT JOIN users pam_user ON pam_user.object_id = membership.source_object_id
  GROUP BY role.object_id, role.source_id, role.display_name
),
role_access AS (
  SELECT grant_access.source_object_id AS role_object_id,
         count(DISTINCT safe.object_id)::int AS safe_count
  FROM active_relationships grant_access
  JOIN roles role ON role.object_id = grant_access.source_object_id
  JOIN safes safe ON safe.object_id = grant_access.target_object_id
  WHERE grant_access.relationship_type = 'role_grants_access'
  GROUP BY grant_access.source_object_id
),
role_state AS (
  SELECT members.*, coalesce(access.safe_count, 0)::int AS safe_count
  FROM role_members members
  LEFT JOIN role_access access ON access.role_object_id = members.object_id
),
empty_group_items AS (
  SELECT jsonb_build_object(
           'object_id', role.object_id, 'display_name', role.display_name,
           'source_id', role.source_id, 'member_count', role.member_count,
           'reason', 'No tiene usuarios PAM activos asignados mediante user_has_role.'
         ) AS item,
         lower(role.display_name) AS sort_name, role.object_id AS sort_id
  FROM role_state role
  WHERE role.member_count = 0
),
identical_group_items AS (
  SELECT jsonb_build_object(
           'object_id', role.object_id, 'display_name', role.display_name,
           'source_id', role.source_id, 'member_count', role.member_count,
           'safe_count', role.safe_count,
           'peer_groups', jsonb_agg(
             jsonb_build_object(
               'object_id', peer.object_id, 'display_name', peer.display_name,
               'source_id', peer.source_id, 'safe_count', peer.safe_count
             ) ORDER BY lower(peer.display_name), peer.object_id
           ),
           'reason', 'Comparte exactamente el mismo conjunto no vacío de usuarios PAM activos con otro grupo.'
         ) AS item,
         lower(role.display_name) AS sort_name, role.object_id AS sort_id
  FROM role_state role
  JOIN role_state peer
    ON peer.object_id <> role.object_id
   AND role.member_count > 0
   AND peer.member_count > 0
   AND peer.member_ids = role.member_ids
  GROUP BY role.object_id, role.source_id, role.display_name,
           role.member_count, role.safe_count
),
redundant_group_items AS (
  SELECT jsonb_build_object(
           'object_id', role.object_id, 'display_name', role.display_name,
           'source_id', role.source_id, 'member_count', role.member_count,
           'safe_count', role.safe_count,
           'peer_groups', jsonb_agg(
             jsonb_build_object(
               'object_id', peer.object_id, 'display_name', peer.display_name,
               'source_id', peer.source_id, 'safe_count', peer.safe_count
             ) ORDER BY lower(peer.display_name), peer.object_id
           ),
           'reason', 'Tiene los mismos usuarios activos que un grupo con acceso a Safes, pero este grupo no concede acceso.'
         ) AS item,
         lower(role.display_name) AS sort_name, role.object_id AS sort_id
  FROM role_state role
  JOIN role_state peer
    ON peer.object_id <> role.object_id
   AND role.member_count > 0
   AND peer.member_count > 0
   AND peer.member_ids = role.member_ids
   AND peer.safe_count > 0
  WHERE role.safe_count = 0
  GROUP BY role.object_id, role.source_id, role.display_name,
           role.member_count, role.safe_count
),
orphan_psm_items AS (
  SELECT jsonb_build_object(
           'object_id', psm.object_id, 'display_name', psm.display_name,
           'source_id', psm.source_id,
           'reason', 'No tiene una relación activa platform_uses_psm desde una plataforma PAM activa.'
         ) AS item,
         lower(psm.display_name) AS sort_name, psm.object_id AS sort_id
  FROM psms psm
  WHERE NOT EXISTS (
    SELECT 1
    FROM active_relationships reference
    JOIN platforms platform ON platform.object_id = reference.source_object_id
    WHERE reference.relationship_type = 'platform_uses_psm'
      AND reference.target_object_id = psm.object_id
  )
),
platforms_without_accounts_items AS (
  SELECT jsonb_build_object(
           'object_id', platform.object_id, 'display_name', platform.display_name,
           'source_id', platform.source_id,
           'reason', 'No tiene cuentas PAM activas con platform_id igual al identificador de esta plataforma.'
         ) AS item,
         lower(platform.display_name) AS sort_name, platform.object_id AS sort_id
  FROM platforms platform
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.cyberark_accounts account
    WHERE account.platform_id = platform.source_id
      AND account.lifecycle_status = 'active'
  )
),
safes_with_active_users AS (
  SELECT DISTINCT safe.object_id AS safe_object_id
  FROM active_relationships grant_access
  JOIN roles role ON role.object_id = grant_access.source_object_id
  JOIN safes safe ON safe.object_id = grant_access.target_object_id
  JOIN active_relationships membership
    ON membership.target_object_id = role.object_id
   AND membership.relationship_type = 'user_has_role'
  JOIN users pam_user ON pam_user.object_id = membership.source_object_id
  WHERE grant_access.relationship_type = 'role_grants_access'
),
safes_without_users_items AS (
  -- Preserve Safe inventory scope and account-type classification separately;
  -- one is not silently derived from the other.
  SELECT jsonb_build_object(
           'object_id', safe.object_id, 'display_name', safe.display_name,
           'source_id', safe.source_id,
           'inventory_scope', coalesce(metadata.inventory_scope, 'pending'),
           'account_type_classification', metadata.account_type_classification,
           'classification_status', metadata.classification_status,
           'reason', 'No tiene usuarios PAM activos alcanzables mediante relaciones activas usuario→rol→Safe.'
         ) AS item,
         lower(safe.display_name) AS sort_name, safe.object_id AS sort_id
  FROM safes safe
  LEFT JOIN safes_with_active_users reachable ON reachable.safe_object_id = safe.object_id
  LEFT JOIN public.cyberark_safe_metadata metadata
    ON metadata.safe_number::text = safe.source_id
  WHERE reachable.safe_object_id IS NULL
),
signal_rows AS (
  SELECT 'empty_groups'::text AS signal,
         (SELECT count(*)::int FROM empty_group_items) AS count,
         (SELECT count(*)::int FROM roles) AS denominator,
         coalesce((SELECT jsonb_agg(item ORDER BY sort_name, sort_id) FROM empty_group_items), '[]'::jsonb) AS items
  UNION ALL
  SELECT 'identical_member_groups',
         (SELECT count(*)::int FROM identical_group_items),
         (SELECT count(*)::int FROM role_state WHERE member_count > 0),
         coalesce((SELECT jsonb_agg(item ORDER BY sort_name, sort_id) FROM identical_group_items), '[]'::jsonb)
  UNION ALL
  SELECT 'redundant_groups_with_access_peer',
         (SELECT count(*)::int FROM redundant_group_items),
         (SELECT count(*)::int FROM role_state WHERE member_count > 0),
         coalesce((SELECT jsonb_agg(item ORDER BY sort_name, sort_id) FROM redundant_group_items), '[]'::jsonb)
  UNION ALL
  SELECT 'orphan_psm',
         (SELECT count(*)::int FROM orphan_psm_items),
         (SELECT count(*)::int FROM psms),
         coalesce((SELECT jsonb_agg(item ORDER BY sort_name, sort_id) FROM orphan_psm_items), '[]'::jsonb)
  UNION ALL
  SELECT 'platforms_without_accounts',
         (SELECT count(*)::int FROM platforms_without_accounts_items),
         (SELECT count(*)::int FROM platforms),
         coalesce((SELECT jsonb_agg(item ORDER BY sort_name, sort_id) FROM platforms_without_accounts_items), '[]'::jsonb)
  UNION ALL
  SELECT 'safes_without_active_users',
         (SELECT count(*)::int FROM safes_without_users_items),
         (SELECT count(*)::int FROM safes),
         coalesce((SELECT jsonb_agg(item ORDER BY sort_name, sort_id) FROM safes_without_users_items), '[]'::jsonb)
)
SELECT signal, count, denominator, items, statement_timestamp() AS computed_at,
       (SELECT jsonb_agg(jsonb_build_object(
          'family', evidence.family, 'latest_attempt', evidence.latest_attempt,
          'last_completed_inventory', evidence.last_completed_inventory)
          ORDER BY evidence.family)
        FROM run_evidence evidence
        WHERE evidence.family = 'pam_inventory' OR signal = 'orphan_psm') AS inventory_runs
FROM signal_rows
ORDER BY signal
"""


async def get_pam_cleanup_signals(pool: AsyncConnectionPool) -> dict:
    """Return counts and explanatory rows from one consistent SQL statement."""
    rows = await fetch_all(pool, _CLEANUP_SIGNALS_SQL, (PAM_SOURCE_SYSTEM,))
    result: dict[str, dict] = {}
    for row in rows:
        signal = row["signal"]
        items = row["items"] or []
        if signal in GROUP_SIGNALS:
            for item in items:
                factory_label = FACTORY_GROUP_LABELS.get(item["display_name"])
                item["is_factory"] = factory_label is not None
                item["factory_label"] = factory_label
                if factory_label:
                    item["reason"] += " Es un grupo de fábrica; no se sugiere su baja automática."
        result[signal] = {
            "count": row["count"],
            "denominator": row["denominator"],
            "items": items,
            "computed_at": row["computed_at"],
            "inventory_runs": row["inventory_runs"],
        }
    return result
