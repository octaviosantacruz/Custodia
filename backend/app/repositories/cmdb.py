from psycopg_pool import AsyncConnectionPool

from ..db import fetch_all

OBJECT_TYPES = ("user", "role", "safe", "platform", "psm", "access_policy", "sia")

async def get_cmdb_coverage(pool: AsyncConnectionPool):
    # Scoped to source_system='cyberark': the PAM/SIA chains are specifically about
    # CyberArk-sourced objects. Other sources (e.g. identity_administration) use the
    # same object_type/relationship_type values and must not blend into these counts.
    objects = await fetch_all(pool, """
        WITH object_types(object_type) AS (
          VALUES ('user'), ('role'), ('safe'), ('platform'), ('psm'), ('access_policy'), ('sia')
        )
        SELECT t.object_type,
               count(o.object_id) FILTER (WHERE o.lifecycle_status = 'active')::int AS active,
               count(o.object_id) FILTER (WHERE o.data_quality_status = 'clean' AND o.lifecycle_status = 'active')::int AS clean,
               count(o.object_id) FILTER (WHERE o.data_quality_status IN ('obsolete', 'duplicate'))::int AS quality_issues
        FROM object_types t
        LEFT JOIN public.cyberark_inventory_objects o ON o.object_type = t.object_type AND o.source_system = 'cyberark'
        GROUP BY t.object_type
        ORDER BY array_position(ARRAY['user','role','safe','platform','psm','access_policy','sia'], t.object_type)
    """)
    relationships = await fetch_all(pool, """
        SELECT relationship_type, count(*)::int AS count
        FROM public.cyberark_inventory_relationships relationship
        JOIN public.cyberark_inventory_objects source
          ON source.object_id = relationship.source_object_id
         AND source.lifecycle_status = 'active'
         AND source.source_system = 'cyberark'
        JOIN public.cyberark_inventory_objects target
          ON target.object_id = relationship.target_object_id
         AND target.lifecycle_status = 'active'
         AND target.source_system = 'cyberark'
        WHERE relationship.lifecycle_status = 'active'
        GROUP BY relationship_type
        ORDER BY relationship_type
    """)
    identity_admin_objects = await fetch_all(pool, """
        WITH object_types(object_type) AS (VALUES ('user'), ('role'))
        SELECT t.object_type,
               count(o.object_id) FILTER (WHERE o.lifecycle_status = 'active')::int AS active
        FROM object_types t
        LEFT JOIN public.cyberark_inventory_objects o
          ON o.object_type = t.object_type AND o.source_system = 'identity_administration'
        GROUP BY t.object_type
        ORDER BY t.object_type
    """)
    sia_objects = await fetch_all(pool, """
        SELECT count(*) FILTER (WHERE lifecycle_status = 'active')::int AS active
        FROM public.cyberark_inventory_objects
        WHERE source_system = 'sia' AND object_type = 'access_policy'
    """)
    counts = {row['object_type']: row['active'] for row in objects}
    relationship_counts = {row['relationship_type']: row['count'] for row in relationships}
    pam_object_types = ('user', 'role', 'safe', 'platform', 'psm')
    pam_relationship_types = ('user_has_role', 'role_grants_access', 'safe_uses_platform', 'platform_uses_psm')
    pam_objects_present = all(counts[key] > 0 for key in pam_object_types)
    pam_relationships_present = all(relationship_counts.get(key, 0) > 0 for key in pam_relationship_types)
    pam_ready = pam_objects_present and pam_relationships_present
    pam_partial = any(counts[key] > 0 for key in pam_object_types) or any(
        relationship_counts.get(key, 0) > 0 for key in pam_relationship_types
    )
    sia_ready = all(counts[key] > 0 for key in ('user', 'role', 'access_policy', 'sia'))
    return {
        'objects': objects,
        'relationships': relationships,
        'chains': {
            'pam': 'ready' if pam_ready else 'partial' if pam_partial else 'pending_sources',
            'sia': 'ready' if sia_ready else 'pending_sources',
        },
        'identity_administration': {row['object_type']: row['active'] for row in identity_admin_objects},
        'sia': {'access_policy': sia_objects[0]['active'] if sia_objects else 0},
    }
