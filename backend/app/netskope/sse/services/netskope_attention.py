"""NSK-EXP-UEBA-001: the risk review queue (UCI Poor/Moderate) and, apart, the ADEM worst users.

Both inputs are bounded (UCI: Poor/Moderate users ordered by score; ADEM ``getentities`` only ever
returns the 100 lowest scores). The queue (``rows``) is risk only and feeds the Riesgo view; the ADEM side
(``performance_rows``) feeds Rendimiento. A low ADEM score alone never puts a person in the risk queue.
Neither is a tenant-wide distribution. A score from a source that did not list the user is "Sin dato", never zero.
"""

from typing import Any

QUEUE_LIMIT = 50
UCI_RANK = {"Poor": 0, "Moderate": 1}


def _key(email: Any) -> str | None:
    return email.strip().lower() if isinstance(email, str) and email.strip() else None


# Netskope DEM score bands (docs.netskope.com "User Overview"): Poor 0-30, Fair 31-70, Good 71-100.
POOR_MAX = 30
FAIR_MAX = 70


def performance_band(score: Any) -> str | None:
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return None
    rounded = round(score)
    return "poor" if rounded <= POOR_MAX else "fair" if rounded <= FAIR_MAX else "good"


def presence_state(days: dict[str, int] | None) -> str:
    """"office" if the person's devices reported on-prem on at least one day of the window (a hybrid week
    counts); "remote" if they only reported off-prem; otherwise "unknown" (no device, unconfigured or no
    data is never treated as remote)."""
    days = days or {}
    if days.get("office_days"):
        return "office"
    return "remote" if days.get("remote_days") else "unknown"


def attention_emails(uci_rows: list[dict[str, Any]], adem_rows: list[dict[str, Any]]) -> list[str]:
    return sorted({key for row in (*uci_rows, *adem_rows) if (key := _key(row.get("email"))) is not None})


def build_attention_queue(uci_rows: list[dict[str, Any]], adem_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return build_attention(uci_rows, adem_rows)["rows"]


def build_attention(
    uci_rows: list[dict[str, Any]], adem_rows: list[dict[str, Any]],
    presence: dict[str, dict[str, int]] | None = None,
) -> dict[str, Any]:
    """The capped queue plus an office summary over every person with an ADEM score (before the cap).

    Office counts are people in that bounded list (Netskope's 100 lowest) whose device Netskope placed on-prem,
    split by Netskope's own score bands. Good is not counted: it only appears if the list reaches above 70.
    These are counts over that list, not a tenant-wide rate.
    """
    presence = presence or {}
    people: dict[str, dict[str, Any]] = {}
    for row in uci_rows:
        key = _key(row.get("email"))
        if key is None:
            continue
        people[key] = {
            "email": key, "name": row.get("name"), "user_id": row.get("user_id"),
            "company": row.get("company"), "uci_rating": row.get("rating"), "uci_score": row.get("score"), "uci_previous": row.get("previous_score"),
            "adem_score": None,
        }
    for row in adem_rows:
        key = _key(row.get("email"))
        score = row.get("exp_score")
        if key is None or isinstance(score, bool) or not isinstance(score, (int, float)):
            continue
        person = people.setdefault(key, {
            "email": key, "name": None, "user_id": None, "company": None,
            "uci_rating": None, "uci_score": None, "uci_previous": None, "adem_score": None,
        })
        person["adem_score"] = score

    for key, person in people.items():
        person["presence"] = presence_state(presence.get(key))
        person["office_days"] = (presence.get(key) or {}).get("office_days", 0)
        person["performance_band"] = performance_band(person["adem_score"])
    scored = [person for person in people.values() if person["adem_score"] is not None]
    in_office = [person for person in scored if person["presence"] == "office"]
    summary = {
        "adem_listed": len(scored),
        "office_listed": len(in_office),
        "office_poor": sum(1 for person in in_office if person["performance_band"] == "poor"),
        "office_fair": sum(1 for person in in_office if person["performance_band"] == "fair"),
        "remote_listed": sum(1 for person in scored if person["presence"] == "remote"),
        "unknown_presence": sum(1 for person in scored if person["presence"] == "unknown"),
    }

    def order(person: dict[str, Any]) -> tuple[Any, ...]:
        return (UCI_RANK[person["uci_rating"]], person["uci_score"] if person["uci_score"] is not None else 10**6, person["email"])

    for person in people.values():
        person["reasons"] = [name for name, present in (("uci", person["uci_rating"] is not None), ("adem", person["adem_score"] is not None)) if present]
    # The review queue is risk only (Poor before Moderate, lowest score first); performance has its own rows below.
    queue = sorted((person for person in people.values() if person["uci_rating"] in UCI_RANK), key=order)[:QUEUE_LIMIT]
    # Everyone Netskope listed with a score (at most its 100 lowest), worst first, for the performance view.
    performance = sorted(scored, key=lambda person: (person["adem_score"], person["email"]))
    return {"rows": queue, "performance_rows": performance, "summary": summary}
