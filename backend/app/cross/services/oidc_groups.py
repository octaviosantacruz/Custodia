import os

from app.cross.repositories.oidc_groups import observed_group_members
from app.cross.services.oidc_mapping import effective_role_pairs


async def list_observed_oidc_groups(pool):
    """Mapped groups with the roles each grants (ACCESS-UI-001) and the members seen at login."""
    pairs, source = await effective_role_pairs(pool)
    roles_by_group: dict[str, list[str]] = {}
    for group, role in pairs:
        roles_by_group.setdefault(group, []).append(role)
    summary, members = await observed_group_members(
        pool, issuer=os.environ.get("OIDC_ISSUER_URL", "").strip(), groups=list(roles_by_group),
    )
    rows = []
    for group, role_codes in sorted(roles_by_group.items()):
        observed = [member for member in members if member["group_name"] == group]
        rows.append({
            "group": group, "role_codes": sorted(role_codes),
            "member_count": observed[0]["member_count"] if observed else 0,
            "members": [{key: member[key] for key in ("actor_id", "email", "display_name", "groups_observed_at")}
                        for member in observed],
        })
    return {"rows": rows, "source": source, **summary}
