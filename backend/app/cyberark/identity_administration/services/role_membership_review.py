"""Exact membership coincidences for review; never infer equal permissions."""
from collections import defaultdict

from app.cross.services.cmdb_models import InventoryObject, InventoryRelationship
from app.cyberark.identity_administration.services.identity_admin_mapping import SOURCE_SYSTEM


def review_role_memberships_detailed(objects: list[InventoryObject], relationships: list[InventoryRelationship]) -> dict:
    roles = {obj.source_id: obj for obj in objects if obj.source_system == SOURCE_SYSTEM and obj.object_type == "role" and obj.lifecycle_status == "active"}
    members = defaultdict(set)
    for edge in relationships:
        if edge.source_system == SOURCE_SYSTEM and edge.relationship_type == "identity_member_of" and edge.target_id in roles:
            members[edge.target_id].add((edge.source_type, edge.source_id))
    for role_id, role in roles.items():
        for ref in role.attributes.get("unresolved_members", []):
            members[role_id].add((ref["kind"], ref["source_id"]))

    direct, users = defaultdict(list), defaultdict(list)
    excluded = []
    excluded_ids = set()
    for root_id, role in roles.items():
        if role.attributes.get("membership_status") != "complete":
            excluded.append(role.display_name)
            excluded_ids.add(root_id)
            continue
        refs = role.attributes.get("unresolved_members", [])
        if role.attributes.get("unresolved_member_count", 0) != len(refs):
            excluded.append(role.display_name)
            excluded_ids.add(root_id)
            continue
        if members[root_id] and all(kind in {"user", "role"} for kind, _ in members[root_id]):
            direct[frozenset(members[root_id])].append(role)
        seen, queue, people = set(), [root_id], set()
        visited = []
        complete = True
        while queue:
            current = queue.pop()
            if current in seen:
                continue
            seen.add(current)
            child = roles.get(current)
            if child is None or child.attributes.get("membership_status") != "complete" or child.attributes.get("unresolved_member_count", 0) != len(child.attributes.get("unresolved_members", [])):
                complete = False
                break
            visited.append(child)
            for kind, member_id in sorted(members[current]):
                if kind == "user":
                    people.add(member_id)
                elif kind == "role":
                    queue.append(member_id)
                else:
                    complete = False
        if complete and people:
            users[frozenset(people)].append((role, visited))
        elif not complete:
            excluded.append(role.display_name)
            excluded_ids.add(root_id)

    def role_ref(item):
        return {"id": item.source_id, "object_id": item.attributes.get("object_id"), "name": item.display_name}

    direct_clusters = []
    for signature, matching_roles in direct.items():
        if len(matching_roles) > 1:
            sorted_roles = sorted(matching_roles, key=lambda item: (item.display_name.casefold(), item.source_id))
            direct_clusters.append({"roles": [role_ref(item) for item in sorted_roles], "direct_members": len(signature)})
    direct_clusters.sort(key=lambda row: [(item["name"].casefold(), item["id"]) for item in row["roles"]])

    user_clusters = []
    for signature, matching_roles in users.items():
        if len(matching_roles) > 1:
            sorted_roles = sorted(matching_roles, key=lambda pair: (pair[0].display_name.casefold(), pair[0].source_id))
            user_clusters.append({
                "roles": [{
                    **role_ref(role),
                    "traversal": [role_ref(item) for item in visited],
                } for role, visited in sorted_roles],
                "referenced_accounts": len(signature),
            })
    user_clusters.sort(key=lambda row: [(item["name"].casefold(), item["id"]) for item in row["roles"]])

    return {
        "same_direct_members": direct_clusters,
        "same_user_references": user_clusters,
        "roles_with_incomplete_user_paths": sorted(set(excluded)),
        "roles_excluded_count": len(excluded_ids),
        "permissions_status": "not_collected",
    }


def review_role_memberships(objects: list[InventoryObject], relationships: list[InventoryRelationship]) -> dict:
    """Compatibility shape retained for the existing script and callers."""
    detailed = review_role_memberships_detailed(objects, relationships)
    return {
        "same_direct_members": [{"roles": sorted(role["name"] for role in group["roles"]), "direct_members": group["direct_members"]} for group in detailed["same_direct_members"]],
        "same_user_references": [{"roles": sorted(role["name"] for role in group["roles"]), "referenced_accounts": group["referenced_accounts"]} for group in detailed["same_user_references"]],
        "roles_with_incomplete_user_paths": detailed["roles_with_incomplete_user_paths"],
        "permissions_status": detailed["permissions_status"],
    }
