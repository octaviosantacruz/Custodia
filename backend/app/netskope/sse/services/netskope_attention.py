"""NSK-EXP-UEBA-001: one queue for the operator that joins the UCI list and the ADEM worst users.

Both inputs are bounded (UCI: Poor/Moderate users ordered by score; ADEM ``getentities`` only ever
returns the 100 lowest scores), so the queue ranks who needs attention first. It is not a tenant-wide
distribution. A score from a source that did not list the user is "Sin dato", never zero.
"""

from typing import Any

QUEUE_LIMIT = 50
UCI_RANK = {"Poor": 0, "Moderate": 1}


def _key(email: Any) -> str | None:
    return email.strip().lower() if isinstance(email, str) and email.strip() else None


def build_attention_queue(uci_rows: list[dict[str, Any]], adem_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    people: dict[str, dict[str, Any]] = {}
    for row in uci_rows:
        key = _key(row.get("email"))
        if key is None:
            continue
        people[key] = {
            "email": key, "name": row.get("name"), "user_id": row.get("user_id"),
            "uci_rating": row.get("rating"), "uci_score": row.get("score"), "uci_previous": row.get("previous_score"),
            "adem_score": None,
        }
    for row in adem_rows:
        key = _key(row.get("email"))
        score = row.get("exp_score")
        if key is None or isinstance(score, bool) or not isinstance(score, (int, float)):
            continue
        person = people.setdefault(key, {
            "email": key, "name": None, "user_id": None,
            "uci_rating": None, "uci_score": None, "uci_previous": None, "adem_score": None,
        })
        person["adem_score"] = score

    def order(person: dict[str, Any]) -> tuple[Any, ...]:
        both = person["uci_rating"] is not None and person["adem_score"] is not None
        uci = UCI_RANK.get(person["uci_rating"], 2)
        return (0 if both else 1, uci, person["uci_score"] if person["uci_score"] is not None else 10**6,
                person["adem_score"] if person["adem_score"] is not None else 10**6, person["email"])

    queue = sorted(people.values(), key=order)[:QUEUE_LIMIT]
    for person in queue:
        person["reasons"] = [name for name, present in (("uci", person["uci_rating"] is not None), ("adem", person["adem_score"] is not None)) if present]
    return queue
