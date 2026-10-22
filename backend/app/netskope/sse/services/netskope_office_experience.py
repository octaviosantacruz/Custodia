"""NSK-EXP-OFFICE-001: digital experience measured while people were in the office.

A person's office span on a UTC day runs from the first to the last client event their devices
reported on-prem that day (the presence days the inventory sync records); the remote span is the
same for off-prem. ADEM ``getinfo`` scores exactly the window it is asked for (probe
NSK-EXP-OFFICE-001/v1, 2026-10-19), so each span is scored on its own and an office day is never
averaged with home days. A span shorter than MIN_SPAN_MINUTES is not scored. A missing score is
"Sin dato", never zero, and never counts as good or bad.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from app.netskope.sse.services.netskope_attention import performance_band

MIN_SPAN_MINUTES = 15
# "Peor en oficina": the person's office score is at least this many points below their remote score.
OFFICE_GAP = 15
# Measured days are complete UTC days only (yesterday back to MEASURE_LOOKBACK_DAYS); ADEM answered
# for 7-day-old windows in the probe.
MEASURE_LOOKBACK_DAYS = 7
WINDOW_DAYS = 7


def span_minutes(start: datetime | None, end: datetime | None) -> int:
    if start is None or end is None or end <= start:
        return 0
    return int((end - start).total_seconds() // 60)


def build_spans(rows: list[dict[str, Any]]) -> dict[str, dict[str, tuple[datetime, datetime]]]:
    """Per email, the office ("on-prem") and remote ("off-prem") span worth scoring."""
    spans: dict[str, dict[str, tuple[datetime, datetime]]] = defaultdict(dict)
    for row in rows:
        if span_minutes(row["first_event_at"], row["last_event_at"]) >= MIN_SPAN_MINUTES:
            spans[row["email"]][row["onprem_status"]] = (row["first_event_at"], row["last_event_at"])
    return dict(spans)


def _weighted(rows: list[dict[str, Any]], score: str, minutes: str) -> float | None:
    scored = [(float(row[score]), row[minutes]) for row in rows if row[score] is not None and row[minutes] > 0]
    total = sum(weight for _, weight in scored)
    return round(sum(value * weight for value, weight in scored) / total, 1) if total else None


def summarize_people(day_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per person who was in the office: minute-weighted office and remote scores, worst first."""
    by_person: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in day_rows:
        by_person[row["email"]].append(row)
    people = []
    for email, rows in by_person.items():
        office_rows = [row for row in rows if row["office_minutes"] > 0]
        if not office_rows:
            continue
        office = _weighted(rows, "office_score", "office_minutes")
        remote = _weighted(rows, "remote_score", "remote_minutes")
        people.append({
            "email": email, "name": rows[0].get("name"), "company": rows[0].get("company"),
            "office_days": len({row["event_day"] for row in office_rows}),
            "office_minutes": sum(row["office_minutes"] for row in rows),
            "office_score": office, "office_band": performance_band(office),
            "remote_score": remote,
            "worse_in_office": office is not None and remote is not None and office <= remote - OFFICE_GAP,
        })
    return sorted(people, key=lambda person: (person["office_score"] is None, person["office_score"] or 0, person["email"]))


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def summarize(people: list[dict[str, Any]], days_measured: int) -> dict[str, Any]:
    """Counts by Netskope band plus the average office score and, for the same people, their remote average."""
    measured = [person for person in people if person["office_score"] is not None]
    paired = [person for person in measured if person["remote_score"] is not None]
    return {
        "office_avg": _mean([person["office_score"] for person in measured]),
        "remote_avg": _mean([person["remote_score"] for person in paired]),
        "paired": len(paired),
        "office_people": len(people), "measured": len(measured),
        "poor": sum(1 for person in measured if person["office_band"] == "poor"),
        "fair": sum(1 for person in measured if person["office_band"] == "fair"),
        "good": sum(1 for person in measured if person["office_band"] == "good"),
        "worse_in_office": sum(1 for person in people if person["worse_in_office"]),
        "days_measured": days_measured,
    }


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def weekly_series(day_rows: list[dict[str, Any]], measured_days: list[date], weeks: int, today: date) -> list[dict[str, Any]]:
    """Monday-to-Sunday UTC weeks, oldest first; each week aggregates its own measured days only.

    A week with no measured day has null counts ("Sin medición"), never zeros.
    """
    current = week_start(today)
    starts = [current - timedelta(weeks=offset) for offset in range(weeks - 1, -1, -1)]
    rows_by_week: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for row in day_rows:
        rows_by_week[week_start(row["event_day"])].append(row)
    days_by_week: dict[date, int] = defaultdict(int)
    for day in measured_days:
        days_by_week[week_start(day)] += 1
    series = []
    for start in starts:
        days = days_by_week.get(start, 0)
        counts = summarize(summarize_people(rows_by_week.get(start, [])), days) if days else None
        series.append({
            "week_start": start, "days_measured": days,
            **{key: (counts[key] if counts else None) for key in ("office_people", "measured", "poor", "fair", "worse_in_office", "office_avg", "remote_avg")},
        })
    return series


WEEKDAYS = ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")


def weekday_breakdown(day_rows: list[dict[str, Any]], measured_days: list[date]) -> list[dict[str, Any]]:
    """Per weekday over the measured days: people in the office per day, minute-weighted office score and
    person-days with a poor or fair office score. A weekday never measured is null, never zero."""
    days_by_weekday: dict[int, set[date]] = defaultdict(set)
    for day in measured_days:
        days_by_weekday[day.weekday()].add(day)
    result = []
    for weekday, name in enumerate(WEEKDAYS):
        days = days_by_weekday.get(weekday, set())
        rows = [row for row in day_rows if row["event_day"] in days and row["office_minutes"] > 0]
        flagged = sum(1 for row in rows if row["office_score"] is not None and performance_band(float(row["office_score"])) in ("poor", "fair"))
        result.append({
            "weekday": weekday, "name": name, "days_measured": len(days),
            "office_people_per_day": round(len(rows) / len(days), 1) if days else None,
            "office_avg": _weighted(rows, "office_score", "office_minutes") if days else None,
            "flagged_person_days": flagged if days else None,
        })
    return result


COMPANY_LIMIT = 12
NO_COMPANY = "Sin empresa"


def company_breakdown(people: list[dict[str, Any]]) -> dict[str, Any]:
    """Office people per company (largest first, up to COMPANY_LIMIT), with the rest counted apart."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for person in people:
        groups[person.get("company") or NO_COMPANY].append(person)
    rows = []
    for company, members in groups.items():
        measured = [person for person in members if person["office_score"] is not None]
        rows.append({
            "company": company, "office_people": len(members), "measured": len(measured),
            "flagged": sum(1 for person in measured if person["office_band"] in ("poor", "fair")),
            "worse_in_office": sum(1 for person in members if person["worse_in_office"]),
            "office_avg": _mean([person["office_score"] for person in measured]),
        })
    rows.sort(key=lambda row: (-row["office_people"], row["company"]))
    return {"rows": rows[:COMPANY_LIMIT], "omitted_people": sum(row["office_people"] for row in rows[COMPANY_LIMIT:])}


def person_days(window: list[date], presence: list[dict[str, Any]], rows: list[dict[str, Any]], measured_days: set[date]) -> list[dict[str, Any]]:
    """One entry per day of the window: where the person's devices reported from and, once measured, the scores.

    office: a device reported on-prem that day; remote: only off-prem; no_signal: no classified device event.
    The place comes from the presence the sync records; a day not yet measured keeps its place with
    measured=false, so "pending" is never confused with "offline" or "remote".
    """
    places = {row["event_day"]: row for row in presence}
    scores = {row["event_day"]: row for row in rows}
    days = []
    for day in window:
        place = places.get(day)
        score = scores.get(day) or {}
        days.append({
            "day": day,
            "place": "office" if place and place["office"] else "remote" if place and place["remote"] else "no_signal",
            "measured": day in measured_days,
            "office_minutes": score.get("office_minutes", 0), "office_score": score.get("office_score"),
            "remote_minutes": score.get("remote_minutes", 0), "remote_score": score.get("remote_score"),
        })
    return days


TIMELINE_MIN_PEOPLE = 5


def timeline_series(
    first: date, last: date, measured_days: list[date], baseline: list[dict[str, Any]], person: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """NSK-EXP-OFFICE-002: one point per day from the first to the last measured day in [first, last].

    Days before the measurement existed are not returned; an unmeasured day in between is measured=False with
    null values, never zero. Each average is per person (everyone weighs the same), with the people it covers so
    a day with few people (under TIMELINE_MIN_PEOPLE) can be told apart. The person's own scores ride along
    when a person was asked for; their day without a score is null.
    """
    measured = sorted(day for day in set(measured_days) if first <= day <= last)
    if not measured:
        return []
    by_day = {row["event_day"]: row for row in baseline}
    mine = {row["event_day"]: row for row in person or []}

    def rounded(value: Any) -> float | None:
        return None if value is None else round(float(value), 1)

    points = []
    day = measured[0]
    done = set(measured)
    while day <= measured[-1]:
        row, own = by_day.get(day, {}), mine.get(day, {})
        is_measured = day in done
        point = {
            "day": day, "measured": is_measured,
            "office_avg": rounded(row.get("office_avg")) if is_measured else None,
            "office_people": int(row.get("office_people") or 0) if is_measured else None,
            "remote_avg": rounded(row.get("remote_avg")) if is_measured else None,
            "remote_people": int(row.get("remote_people") or 0) if is_measured else None,
        }
        if person is not None:
            point |= {
                "person_office": rounded(own.get("office_score")) if is_measured else None,
                "person_office_minutes": int(own.get("office_minutes") or 0),
                "person_remote": rounded(own.get("remote_score")) if is_measured else None,
                "person_remote_minutes": int(own.get("remote_minutes") or 0),
            }
        points.append(point)
        day += timedelta(days=1)
    return points
