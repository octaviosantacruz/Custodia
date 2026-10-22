"""NSK-EXP-OFFICE-001: office spans, minute-weighted scores, weekly series, the daily task and the strict route."""

import unittest
from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx

from app.netskope.sse import netskope_sync
from app.netskope.sse.integrations.netskope import NetskopeError, netskope_office_experience_configured
from app.netskope.sse.services.netskope_office_experience import (
    MIN_SPAN_MINUTES, OFFICE_GAP, build_spans, company_breakdown, person_days, summarize, summarize_people, timeline_series,
    weekday_breakdown, weekly_series,
)
from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app

T0 = datetime(2026, 10, 12, 12, tzinfo=timezone.utc)
MONDAY = date(2026, 10, 12)


def day_row(email, day, office_minutes=0, office_score=None, remote_minutes=0, remote_score=None, **extra):
    return {"email": email, "event_day": day, "office_minutes": office_minutes, "office_score": office_score,
            "remote_minutes": remote_minutes, "remote_score": remote_score, **extra}


class OfficeExperienceServiceTests(unittest.TestCase):
    def test_spans_shorter_than_the_minimum_are_not_scored(self):
        rows = [
            {"email": "a@x.test", "onprem_status": "on-prem", "first_event_at": T0, "last_event_at": T0 + timedelta(hours=8)},
            {"email": "a@x.test", "onprem_status": "off-prem", "first_event_at": T0, "last_event_at": T0 + timedelta(minutes=MIN_SPAN_MINUTES - 1)},
            {"email": "b@x.test", "onprem_status": "on-prem", "first_event_at": T0, "last_event_at": T0},
        ]
        self.assertEqual(build_spans(rows), {"a@x.test": {"on-prem": (T0, T0 + timedelta(hours=8))}})

    def test_office_score_is_weighted_by_minutes_and_home_days_never_dilute_it(self):
        rows = [
            day_row("h@x.test", MONDAY, office_minutes=480, office_score=20, name="Hybrid", company="ACME"),
            day_row("h@x.test", MONDAY + timedelta(days=1), office_minutes=120, office_score=70),
            day_row("h@x.test", MONDAY + timedelta(days=2), remote_minutes=500, remote_score=95),
        ]
        [person] = summarize_people(rows)
        self.assertEqual((person["office_days"], person["office_minutes"], person["office_score"]), (2, 600, 30.0))
        self.assertEqual((person["office_band"], person["remote_score"], person["worse_in_office"]), ("poor", 95.0, True))
        self.assertEqual((person["name"], person["company"]), ("Hybrid", "ACME"))

    def test_remote_only_people_are_left_out_and_a_missing_score_is_never_zero_or_good(self):
        rows = [
            day_row("r@x.test", MONDAY, remote_minutes=300, remote_score=40),
            day_row("n@x.test", MONDAY, office_minutes=300, office_score=None, remote_minutes=60, remote_score=90),
            day_row("g@x.test", MONDAY, office_minutes=300, office_score=90, remote_minutes=60, remote_score=90 + OFFICE_GAP - 1),
        ]
        people = summarize_people(rows)
        self.assertEqual([person["email"] for person in people], ["g@x.test", "n@x.test"])
        nodata = people[1]
        self.assertIsNone(nodata["office_score"])
        self.assertIsNone(nodata["office_band"])
        self.assertFalse(nodata["worse_in_office"])
        self.assertFalse(people[0]["worse_in_office"])
        self.assertEqual(summarize(people, 7), {"office_people": 2, "measured": 1, "poor": 0, "fair": 0, "good": 1, "worse_in_office": 0, "days_measured": 7,
                                                "office_avg": 90.0, "remote_avg": 90.0 + OFFICE_GAP - 1, "paired": 1})

    def test_weekly_series_is_oldest_first_and_unmeasured_weeks_are_null_not_zero(self):
        rows = [day_row("a@x.test", MONDAY, office_minutes=300, office_score=50)]
        series = weekly_series(rows, [MONDAY, MONDAY + timedelta(days=1)], 3, MONDAY + timedelta(days=9))
        self.assertEqual([week["week_start"] for week in series], [MONDAY - timedelta(weeks=1), MONDAY, MONDAY + timedelta(weeks=1)])
        self.assertEqual(series[0]["days_measured"], 0)
        self.assertIsNone(series[0]["office_people"])
        self.assertEqual((series[1]["days_measured"], series[1]["office_people"], series[1]["fair"], series[1]["poor"]), (2, 1, 1, 0))
        self.assertIsNone(series[2]["poor"])


class OfficeExperienceBreakdownTests(unittest.TestCase):
    def test_weekday_breakdown_averages_measured_days_and_leaves_unmeasured_weekdays_null(self):
        tuesday = MONDAY + timedelta(days=1)
        rows = [
            day_row("a@x.test", MONDAY, office_minutes=60, office_score=20), day_row("b@x.test", MONDAY, office_minutes=180, office_score=80),
            day_row("a@x.test", MONDAY + timedelta(weeks=1), office_minutes=60, office_score=90),
            day_row("c@x.test", MONDAY, remote_minutes=300, remote_score=10),
        ]
        days = weekday_breakdown(rows, [MONDAY, MONDAY + timedelta(weeks=1), tuesday])
        monday, tue, wednesday = days[0], days[1], days[2]
        self.assertEqual((monday["days_measured"], monday["office_people_per_day"], monday["office_avg"], monday["flagged_person_days"]), (2, 1.5, 70.0, 1))
        self.assertEqual((tue["days_measured"], tue["office_people_per_day"], tue["office_avg"], tue["flagged_person_days"]), (1, 0.0, None, 0))
        self.assertEqual((wednesday["days_measured"], wednesday["office_people_per_day"], wednesday["flagged_person_days"]), (0, None, None))

    def test_company_breakdown_groups_people_and_counts_the_rest_apart(self):
        people = [{"email": f"u{i}@x.test", "company": f"C{i % 14}", "office_score": 50.0, "office_band": "fair", "worse_in_office": False} for i in range(28)]
        people.append({"email": "n@x.test", "company": None, "office_score": None, "office_band": None, "worse_in_office": True})
        result = company_breakdown(people)
        self.assertEqual(len(result["rows"]), 12)
        self.assertEqual(result["rows"][0]["office_people"], 2)
        self.assertEqual(result["omitted_people"], 29 - sum(row["office_people"] for row in result["rows"]))
        everyone = company_breakdown(people[-1:])
        self.assertEqual(everyone["rows"][0], {"company": "Sin empresa", "office_people": 1, "measured": 0, "flagged": 0, "worse_in_office": 1, "office_avg": None})

    def test_person_days_tell_office_remote_no_signal_and_pending_apart(self):
        window = [MONDAY + timedelta(days=offset) for offset in range(4)]
        presence = [{"event_day": window[0], "office": True, "remote": True}, {"event_day": window[1], "office": False, "remote": True},
                    {"event_day": window[3], "office": True, "remote": False}]
        rows = [{"event_day": window[0], "office_minutes": 480, "office_score": 40, "remote_minutes": 60, "remote_score": 90}]
        days = person_days(window, presence, rows, set(window[:3]))
        self.assertEqual([(day["place"], day["measured"]) for day in days], [("office", True), ("remote", True), ("no_signal", True), ("office", False)])
        self.assertEqual((days[0]["office_score"], days[0]["remote_score"]), (40, 90))
        self.assertIsNone(days[3]["office_score"])
        self.assertEqual(days[1]["office_minutes"], 0)


class OfficeExperienceTaskTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        patcher = patch.dict("os.environ", {"NETSKOPE_OFFICE_EXPERIENCE_PATH": "/api/v2/adem/users/getinfo"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def spans(self, count):
        return [
            {"email": f"u{index}@x.test", "onprem_status": status, "first_event_at": T0, "last_event_at": T0 + timedelta(hours=2)}
            for index in range(count) for status in ("on-prem", "off-prem")
        ]

    async def run_task(self, pending, spans, score):
        client = AsyncMock()
        client.get_adem_user_score = score
        replace = AsyncMock()
        with patch.object(netskope_sync, "pending_office_days", new=AsyncMock(return_value=pending)), \
                patch.object(netskope_sync, "office_spans_for_day", new=AsyncMock(return_value=spans)), \
                patch.object(netskope_sync, "replace_office_experience_day", new=replace), \
                patch.object(netskope_sync, "NetskopeSettings"), patch.object(netskope_sync, "OFFICE_CALL_DELAY_SECONDS", 0), \
                patch.object(netskope_sync, "NetskopeClient") as client_class:
            client_class.return_value.__aenter__.return_value = client
            result = await netskope_sync.sync_netskope_office_experience(MagicMock(), uuid4())
        return result, replace, client

    def test_only_the_approved_route_enables_the_task(self):
        with patch.dict("os.environ", {"NETSKOPE_OFFICE_EXPERIENCE_PATH": "/api/v2/adem/users/getentities"}):
            self.assertFalse(netskope_office_experience_configured())
        self.assertTrue(netskope_office_experience_configured())

    async def test_scores_each_span_of_at_most_two_pending_days_and_stores_minutes(self):
        days = [MONDAY, MONDAY + timedelta(days=1), MONDAY + timedelta(days=2)]
        result, replace, client = await self.run_task(days, self.spans(1), AsyncMock(side_effect=[40, 90, 41, 91]))
        self.assertEqual([call.args[2] for call in replace.await_args_list], days[:2])
        stored = replace.await_args_list[0].args[3]
        self.assertEqual(stored, [{"email": "u0@x.test", "office_minutes": 120, "office_score": 40, "remote_minutes": 120, "remote_score": 90}])
        start, end = int(T0.timestamp()), int((T0 + timedelta(hours=2)).timestamp())
        self.assertEqual(client.get_adem_user_score.await_args_list[0].args, ("u0@x.test", start, end))
        self.assertEqual(result["office_days_measured"], 2)
        self.assertEqual(result["office_calls"], 4)

    async def test_a_few_failed_calls_are_no_data_but_too_many_leave_the_day_pending(self):
        scores = [NetskopeError("x"), *([80] * 39)]
        result, replace, _ = await self.run_task([MONDAY], self.spans(20), AsyncMock(side_effect=scores))
        stored = replace.await_args.args[3]
        self.assertIsNone(stored[0]["office_score"])
        self.assertEqual(replace.await_args.args[4], 1)
        self.assertEqual(result["office_failed_calls"], 1)
        with self.assertRaises(NetskopeError):
            await self.run_task([MONDAY], self.spans(2), AsyncMock(side_effect=NetskopeError("down")))

    async def test_without_configuration_the_task_refuses_to_run(self):
        with patch.dict("os.environ", {"NETSKOPE_OFFICE_EXPERIENCE_PATH": ""}), self.assertRaises(ValueError):
            await netskope_sync.sync_netskope_office_experience(MagicMock(), uuid4())


class OfficeExperienceRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_requires_uba_read_and_returns_the_week_and_its_series(self):
        route = "app.netskope.sse.services.netskope_office_experience_view."
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        rows = AsyncMock(return_value=[day_row("a@x.test", yesterday, office_minutes=300, office_score=25, remote_minutes=60, remote_score=85)])
        measured = AsyncMock(return_value=[{"event_day": yesterday, "people": 1, "failed_calls": 0, "measured_at": datetime.now(timezone.utc)}])
        audit = AsyncMock()
        run = AsyncMock(return_value={"status": "running", "started_at": datetime.now(timezone.utc), "completed_at": None})
        with patch(route + "office_experience_rows", new=rows), patch(route + "measured_office_days", new=measured), patch(route + "latest_office_run", new=run), \
                patch("app.netskope.sse.api.routes.netskope_uci.record_audit", new=audit):
            self.session.set_permissions(["inventory:read", "netskope:read", "access:manage"])
            self.assertEqual((await self.client.get("/api/cmdb/netskope/experience/office")).status_code, 403)
            rows.assert_not_awaited()
            self.session.set_permissions(["inventory:read", "netskope:uba_read"])
            response = await self.client.get("/api/cmdb/netskope/experience/office?weeks=4")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["summary"], {"office_people": 1, "measured": 1, "poor": 1, "fair": 0, "good": 0, "worse_in_office": 1, "days_measured": 1,
                                           "office_avg": 25.0, "remote_avg": 85.0, "paired": 1})
        self.assertEqual(body["companies"]["rows"][0]["company"], "Sin empresa")
        self.assertEqual(len(body["weekdays"]), 7)
        self.assertEqual(body["people"][0]["office_band"], "poor")
        self.assertEqual(body["measurement"]["status"], "running")
        self.assertEqual(len(body["series"]), 4)
        weeks = {week["week_start"]: week for week in body["series"]}
        self.assertEqual(weeks[(yesterday - timedelta(days=yesterday.weekday())).isoformat()]["poor"], 1)
        self.assertEqual(body["window_end"], yesterday.isoformat())
        self.assertEqual(audit.await_args.kwargs["after_data"]["poor"], 1)
        self.assertNotIn("a@x.test", str(audit.await_args.kwargs["after_data"]))


if __name__ == "__main__":
    unittest.main()


class OfficePersonRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_requires_uba_read_normalizes_the_email_and_audits_without_it(self):
        view = AsyncMock(return_value={"email": "ana@x.test", "window_start": MONDAY, "window_end": MONDAY + timedelta(days=6), "days": [
            {"day": MONDAY, "place": "office", "measured": True, "office_minutes": 480, "office_score": 40, "remote_minutes": 0, "remote_score": None}]})
        audit = AsyncMock()
        route = "app.netskope.sse.api.routes.netskope_uci."
        with patch(route + "office_person_view", new=view), patch(route + "record_audit", new=audit):
            self.session.set_permissions(["inventory:read", "netskope:read"])
            self.assertEqual((await self.client.get("/api/cmdb/netskope/experience/office/person?email=ana@x.test")).status_code, 403)
            view.assert_not_awaited()
            self.session.set_permissions(["inventory:read", "netskope:uba_read"])
            response = await self.client.get("/api/cmdb/netskope/experience/office/person?email=%20Ana@X.test%20")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(view.await_args.args[1], "ana@x.test")
        self.assertEqual(response.json()["days"][0]["place"], "office")
        self.assertNotIn("ana", str(audit.await_args.kwargs["after_data"]))


class OfficeTimelineTests(unittest.TestCase):
    """NSK-EXP-OFFICE-002: the daily timeline."""

    def test_days_run_from_the_first_to_the_last_measured_day_and_a_gap_is_null_not_zero(self):
        first, last = MONDAY - timedelta(days=10), MONDAY + timedelta(days=6)
        measured = [MONDAY, MONDAY + timedelta(days=1), MONDAY + timedelta(days=3)]
        baseline = [{"event_day": MONDAY, "office_avg": 88.04, "office_people": 400, "remote_avg": 90, "remote_people": 300},
                    {"event_day": MONDAY + timedelta(days=1), "office_avg": None, "office_people": 0, "remote_avg": 85.56, "remote_people": 3}]
        points = timeline_series(first, last, measured, baseline, None)
        self.assertEqual([point["day"] for point in points], [MONDAY + timedelta(days=offset) for offset in range(4)])
        self.assertEqual((points[0]["office_avg"], points[0]["office_people"]), (88.0, 400))
        self.assertEqual((points[1]["office_avg"], points[1]["office_people"], points[1]["remote_avg"]), (None, 0, 85.6))
        self.assertEqual((points[2]["measured"], points[2]["office_avg"], points[2]["office_people"]), (False, None, None))
        self.assertEqual((points[3]["measured"], points[3]["office_people"]), (True, 0))
        self.assertNotIn("person_office", points[0])

    def test_the_person_line_rides_along_and_a_day_without_their_score_is_null(self):
        own = [{"event_day": MONDAY, "office_minutes": 480, "office_score": 22.25, "remote_minutes": 0, "remote_score": None}]
        points = timeline_series(MONDAY, MONDAY + timedelta(days=1), [MONDAY, MONDAY + timedelta(days=1)], [], own)
        self.assertEqual((points[0]["person_office"], points[0]["person_office_minutes"], points[0]["person_remote"]), (22.2, 480, None))
        self.assertEqual((points[1]["person_office"], points[1]["person_office_minutes"]), (None, 0))

    def test_nothing_measured_is_an_empty_series(self):
        self.assertEqual(timeline_series(MONDAY, MONDAY + timedelta(days=6), [MONDAY - timedelta(days=1)], [], None), [])


class OfficeTimelineRangeTests(unittest.TestCase):
    def test_days_or_dates_clamped_to_kept_and_complete_days(self):
        from app.netskope.sse.services.netskope_office_experience_view import timeline_range
        today = MONDAY + timedelta(days=7)
        self.assertEqual(timeline_range(today, 30, None, None), (today - timedelta(days=30), today - timedelta(days=1)))
        # One date: that day alone.
        self.assertEqual(timeline_range(today, 30, MONDAY, MONDAY), (MONDAY, MONDAY))
        # Today is not complete and older than 180 days is not kept: both ends are clamped.
        self.assertEqual(timeline_range(today, 30, today - timedelta(days=400), today + timedelta(days=3)),
                         (today - timedelta(days=180), today - timedelta(days=1)))
        self.assertEqual(timeline_range(today, 30, MONDAY, None), (MONDAY, today - timedelta(days=1)))
        for start, end in ((MONDAY + timedelta(days=2), MONDAY), (today, today), (today - timedelta(days=300), today - timedelta(days=200))):
            with self.assertRaises(ValueError):
                timeline_range(today, 30, start, end)


class OfficeTimelineRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_requires_uba_read_passes_filters_and_audits_without_their_values(self):
        view = AsyncMock(return_value={"first": MONDAY, "last": MONDAY + timedelta(days=6), "company": "ACME", "min_people": 5,
                                       "companies": [{"company": "ACME", "people": 2}],
                                       "person": {"email": "ana@x.test", "name": "Ana", "company": "ACME"},
                                       "points": [{"day": MONDAY, "measured": True, "office_avg": 80.0, "office_people": 2, "remote_avg": None,
                                                   "remote_people": 0, "person_office": 70.0, "person_office_minutes": 60}]})
        audit = AsyncMock()
        route = "app.netskope.sse.api.routes.netskope_uci."
        with patch(route + "office_timeline_view", new=view), patch(route + "record_audit", new=audit):
            self.session.set_permissions(["inventory:read", "netskope:read"])
            self.assertEqual((await self.client.get("/api/cmdb/netskope/experience/office/timeline")).status_code, 403)
            view.assert_not_awaited()
            self.session.set_permissions(["inventory:read", "netskope:uba_read"])
            self.assertEqual((await self.client.get("/api/cmdb/netskope/experience/office/timeline?days=500")).status_code, 422)
            response = await self.client.get("/api/cmdb/netskope/experience/office/timeline?days=90&company=ACME&email=%20Ana@X.test%20")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(view.await_args.args[1:4], (90, "ACME", "ana@x.test"))
        self.assertEqual(view.await_args.args[5:], (None, None))
        self.assertEqual(response.json()["points"][0]["person_office"], 70.0)
        logged = str(audit.await_args.kwargs["after_data"])
        self.assertNotIn("ana", logged)
        self.assertNotIn("ACME", logged)


class OfficeTimelineDatesRouteTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = OfficeTimelineRouteTests.asyncSetUp

    async def test_dates_reach_the_view_and_an_empty_range_is_a_422_not_a_500(self):
        route = "app.netskope.sse.api.routes.netskope_uci."
        self.session.set_permissions(["inventory:read", "netskope:uba_read"])
        view = AsyncMock(return_value={"first": MONDAY, "last": MONDAY, "company": None, "min_people": 5, "companies": [], "person": None, "points": []})
        with patch(route + "office_timeline_view", new=view), patch(route + "record_audit", new=AsyncMock()):
            response = await self.client.get("/api/cmdb/netskope/experience/office/timeline?start=2026-10-12&end=2026-10-12")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(view.await_args.args[5:], (MONDAY, MONDAY))
        with patch(route + "record_audit", new=AsyncMock()) as audit:
            response = await self.client.get("/api/cmdb/netskope/experience/office/timeline?start=2026-10-14&end=2026-10-12")
        self.assertEqual(response.status_code, 422)
        self.assertIn("rango", response.json()["detail"])
        audit.assert_not_awaited()
