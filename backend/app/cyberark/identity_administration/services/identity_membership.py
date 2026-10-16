"""Reachable direct SCIM membership, isolated from PAM and flattened user.groups."""
from collections import defaultdict, deque


def membership_graph(root_id: int, nodes: list[dict], edges: list[dict], limit: int = 2000) -> dict | None:
    by_id = {node["object_id"]: node for node in nodes}
    if root_id not in by_id or by_id[root_id]["object_type"] != "role":
        return None
    children = defaultdict(list)
    for edge in edges:
        if edge["parent_id"] in by_id and edge["member_id"] in by_id:
            children[edge["parent_id"]].append(edge["member_id"])
    seen = {root_id}
    queue = deque([root_id])
    selected_edges = []
    truncated = False
    while queue:
        parent = queue.popleft()
        for member in children[parent]:
            if member not in seen:
                if len(seen) >= limit:
                    truncated = True
                    continue
                seen.add(member)
                queue.append(member)
            selected_edges.append({"parent_id": parent, "member_id": member})
    selected = []
    for key in sorted(seen):
        node = by_id[key]
        attrs = node.get("attributes") or {}
        selected.append({
            "object_id": key, "display_name": node["display_name"], "source_id": node["source_id"],
            "kind": "user" if node["object_type"] == "user" else "okta_group" if node["display_name"].lower().startswith("sg_cyberark") else "role",
            "membership_status": attrs.get("membership_status", "not_reported"),
            "unresolved_member_count": attrs.get("unresolved_member_count", 0),
            "direct_member_count": attrs.get("direct_member_count"),
            "unresolved_members": [{"display_name": member.get("display_name", ""), "kind": member["kind"]} for member in attrs.get("unresolved_members", [])],
            "user_name": attrs.get("user_name", "") if node["object_type"] == "user" else "",
            "last_seen_at": node.get("last_seen_at"),
        })
    return {"root_id": root_id, "nodes": selected, "edges": selected_edges, "truncated": truncated}
