"""NSK-EXP-OFFICE-001 read model: the last WINDOW_DAYS complete days and the weekly evolution."""

from datetime import date, timedelta
from typing import Any

from psycopg_pool import AsyncConnectionPool

from app.netskope.sse.repositories.netskope_office_experience import (
    latest_office_run, measured_office_days, office_experience_rows, office_person_identity, office_timeline_companies,
    office_timeline_days, person_office_rows, person_presence_days,
)
from app.netskope.sse.services.netskope_office_experience import (
    NO_COMPANY, OFFICE_GAP, TIMELINE_MIN_PEOPLE, WINDOW_DAYS, company_breakdown, person_days, summarize, summarize_people, week_start, weekday_breakdown,
    timeline_series, weekly_series,
)

PEOPLE_LIMIT = 200


async def office_experience_view(pool: AsyncConnectionPool, weeks: int, today: date) -> dict[str, Any]:
    """People who went to the office in the window (yesterday back WINDOW_DAYS), worst first, plus the series.

    Only complete UTC days are measured, so the window ends yesterday; a week without measured days
    is null in the series, never zero.
    """
    window_end = today - timedelta(days=1)
    window_start = today - timedelta(days=WINDOW_DAYS)
    series_start = week_start(today) - timedelta(weeks=weeks - 1)
    first = min(series_start, window_start)
    rows = await office_experience_rows(pool, first, window_end)
    measured = await measured_office_days(pool, first, window_end)
    people = summarize_people([row for row in rows if window_start <= row["event_day"] <= window_end])
    days_measured = sum(1 for day in measured if window_start <= day["event_day"] <= window_end)
    return {
        "window_start": window_start, "window_end": window_end,
        "last_measured_at": max((day["measured_at"] for day in measured), default=None),
        "office_gap": OFFICE_GAP, "summary": summarize(people, days_measured),
        "measurement": await latest_office_run(pool),
        "people": people[:PEOPLE_LIMIT], "people_total": len(people),
        "series": weekly_series([row for row in rows if row["event_day"] >= series_start], [day["event_day"] for day in measured], weeks, today),
        # By weekday over every measured day of the series; by company over the people of the window.
        "weekdays": weekday_breakdown([row for row in rows if row["event_day"] >= series_start], [day["event_day"] for day in measured if day["event_day"] >= series_start]),
        "companies": company_breakdown(people),
    }


async def office_person_view(pool: AsyncConnectionPool, email: str, today: date) -> dict[str, Any]:
    """The person's last WINDOW_DAYS complete days: where they reported from and, once measured, their scores."""
    first, last = today - timedelta(days=WINDOW_DAYS), today - timedelta(days=1)
    window = [first + timedelta(days=offset) for offset in range(WINDOW_DAYS)]
    measured = {day["event_day"] for day in await measured_office_days(pool, first, last)}
    return {
        "email": email, "window_start": first, "window_end": last,
        "days": person_days(window, await person_presence_days(pool, email, first, last), await person_office_rows(pool, email, first, last), measured),
    }


TIMELINE_MAX_DAYS = 180


def timeline_range(today: date, days: int, start: date | None, end: date | None) -> tuple[date, date]:
    """The last `days` complete days, or [start, end] clamped to what is kept (TIMELINE_MAX_DAYS back) and
    complete (up to yesterday). Raises ValueError for an inverted or entirely out-of-range interval."""
    oldest, yesterday = today - timedelta(days=TIMELINE_MAX_DAYS), today - timedelta(days=1)
    if start is None and end is None:
        return today - timedelta(days=days), yesterday
    first, last = max(start or oldest, oldest), min(end or yesterday, yesterday)
    if first > last:
        raise ValueError("El rango de fechas está vacío o fuera de los últimos 180 días completos.")
    return first, last


async def office_timeline_view(
    pool: AsyncConnectionPool, days: int, company: str | None, email: str | None, today: date,
    start: date | None = None, end: date | None = None,
) -> dict[str, Any]:
    """NSK-EXP-OFFICE-002: the daily average for everyone or one company over the last `days` complete days (or
    the dates asked for), with one person's own line when asked. The companies list feeds the filter."""
    first, last = timeline_range(today, days, start, end)
    measured = [day["event_day"] for day in await measured_office_days(pool, first, last)]
    baseline = await office_timeline_days(pool, first, last, company, NO_COMPANY)
    person = None
    if email:
        identity = await office_person_identity(pool, email) or {}
        person = {"email": email, "name": identity.get("name"), "company": identity.get("company")}
    return {
        "first": first, "last": last, "company": company, "min_people": TIMELINE_MIN_PEOPLE,
        "companies": await office_timeline_companies(pool, first, last, NO_COMPANY),
        "person": person,
        "points": timeline_series(first, last, measured, baseline, await person_office_rows(pool, email, first, last) if email else None),
    }
