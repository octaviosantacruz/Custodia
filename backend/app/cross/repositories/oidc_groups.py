from app.db import fetch_all, fetch_one


async def observed_groups_for_identities(pool, *, issuer: str, actor_ids: list[str]):
    """Exact login observations for the requested page, without membership truncation."""
    if not actor_ids:
        return []
    return await fetch_all(
        pool,
        """SELECT actor_id, observed_groups, groups_observed_at
           FROM public.access_oidc_users
           WHERE issuer = %s AND actor_id = ANY(%s)""",
        (issuer, actor_ids),
    )


async def observed_group_members(pool, *, issuer: str, groups: list[str]):
    summary = await fetch_one(
        pool,
        """SELECT count(*) FILTER (WHERE groups_observed_at IS NOT NULL)::int AS observed_identities,
                  count(*) FILTER (WHERE groups_observed_at IS NULL)::int AS unobserved_identities
           FROM public.access_oidc_users WHERE issuer = %s""",
        (issuer,),
    )
    members = await fetch_all(
        pool,
        """WITH ranked AS (
             SELECT g.group_name, u.actor_id, u.email, u.display_name, u.groups_observed_at,
                    count(*) OVER (PARTITION BY g.group_name)::int AS member_count,
                    row_number() OVER (PARTITION BY g.group_name ORDER BY u.display_name, u.actor_id) AS position
             FROM public.access_oidc_users u
             CROSS JOIN LATERAL unnest(u.observed_groups) AS g(group_name)
             WHERE u.issuer = %s AND g.group_name = ANY(%s::text[])
           ) SELECT group_name, actor_id, email, display_name, groups_observed_at, member_count
             FROM ranked WHERE position <= 100 ORDER BY group_name, display_name, actor_id""",
        (issuer, groups),
    )
    return summary, members
