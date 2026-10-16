"""Behavioral contract tests for the CONN-001/v1 coverage classification."""

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.cross.api.routes.person_client_coverage_models import PersonClientCoverageDetail
from app.cross.services.person_client_coverage import (
    build_person_client_coverage,
    get_person_client_coverage_detail,
)


NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)


def fresh_runs():
    return {
        "identity_administration": {
            "run_id": "identity-run", "status": "completed",
            "started_at": NOW - timedelta(minutes=5), "completed_at": NOW - timedelta(minutes=4),
        },
        "netskope": {
            "run_id": "netskope-run", "status": "completed",
            "started_at": NOW - timedelta(minutes=3), "completed_at": NOW - timedelta(minutes=2),
        },
    }


def person(email, *, identity_records=1, netskope_users=1, recent=0, not_recent=0, ambiguous=0):
    return {
        "object_id": email, "email": email, "display_name": email,
        "identity_records": identity_records, "netskope_users": netskope_users,
        "devices_recent": recent, "devices_not_recent": not_recent,
        "devices_ambiguous": ambiguous,
    }


class PersonClientCoverageTests(unittest.TestCase):
    def test_exact_unique_link_states_include_multiple_devices_and_unknowns(self):
        rows = [
            person("covered@example.test", recent=2),
            person("partial@example.test", recent=1, not_recent=2),
            person("gap@example.test"),
            person("no-netskope@example.test", netskope_users=0),
            person("ambiguous-netskope@example.test", netskope_users=2, recent=1),
            person("ambiguous-device@example.test", recent=1, ambiguous=1),
            person("duplicate-identity@example.test", identity_records=2, recent=1),
            person("duplicate-identity@example.test", identity_records=2, recent=1),
        ]
        summary, classified = build_person_client_coverage(rows, fresh_runs(), now=NOW)

        self.assertEqual([row["status"] for row in classified], [
            "covered", "partial", "gap", "unknown", "unknown", "unknown", "unknown", "unknown",
        ])
        self.assertEqual(summary["counts"], {
            "denominator": 8, "covered": 1, "partial": 1, "gap": 1, "unknown": 5,
            "coverage_percent": 12.5, "devices_recent": 4, "devices_total": 6,
            "device_coverage_percent": 66.67,
        })
        self.assertEqual(summary["metric_version"], "1")
        self.assertEqual(summary["sources"]["identity"]["run_id"], "identity-run")

    def test_a_new_incomplete_or_stale_source_makes_every_identity_unknown(self):
        runs = fresh_runs()
        runs["netskope"] = {
            "run_id": "failed-after-complete", "status": "partial",
            "started_at": NOW, "completed_at": NOW,
        }
        summary, people = build_person_client_coverage(
            [person("ada@example.test", recent=1)], runs, now=NOW,
        )
        self.assertEqual(people[0]["status"], "unknown")
        self.assertEqual(summary["counts"]["denominator"], 1)
        self.assertEqual(summary["counts"]["unknown"], 1)
        self.assertIsNone(summary["counts"]["coverage_percent"])
        self.assertEqual(summary["sources"]["netskope"]["freshness"], "incomplete")

        runs = fresh_runs()
        runs["identity_administration"]["completed_at"] = NOW - timedelta(hours=24)
        summary, people = build_person_client_coverage(
            [person("ada@example.test", recent=1)], runs, now=NOW,
        )
        self.assertEqual(people[0]["status"], "covered", "the exact 24 h boundary remains fresh")
        self.assertEqual(summary["sources"]["identity"]["freshness"], "fresh")

        runs = fresh_runs()
        runs["identity_administration"]["completed_at"] = NOW - timedelta(hours=24, seconds=1)
        summary, people = build_person_client_coverage(
            [person("ada@example.test", recent=1)], runs, now=NOW,
        )
        self.assertEqual(people[0]["status"], "unknown")
        self.assertIsNone(summary["counts"]["coverage_percent"])
        self.assertEqual(summary["sources"]["identity"]["freshness"], "stale")

    def test_missing_denominator_or_source_evidence_never_becomes_zero_percent(self):
        summary, _ = build_person_client_coverage([], fresh_runs(), now=NOW)
        self.assertEqual(summary["counts"]["denominator"], 0)
        self.assertIsNone(summary["counts"]["coverage_percent"])
        self.assertIsNone(summary["counts"]["device_coverage_percent"])

        summary, _ = build_person_client_coverage(
            [person("ada@example.test", recent=1)], {}, now=NOW,
        )
        self.assertEqual(summary["counts"]["unknown"], 1)
        self.assertIsNone(summary["counts"]["coverage_percent"])
        self.assertEqual(summary["sources"]["identity"]["freshness"], "missing")


if __name__ == "__main__":
    unittest.main()


class PersonClientCoverageDetailContractTests(unittest.IsolatedAsyncioTestCase):
    """CONN-TEST-001: detail branches that bypass the classified row."""

    @staticmethod
    def _runs(age_hours=0):
        now = datetime.now(timezone.utc) - timedelta(hours=age_hours)
        return {
            "identity_administration": {
                "run_id": "identity-run", "status": "completed",
                "started_at": now - timedelta(minutes=5), "completed_at": now - timedelta(minutes=4),
            },
            "netskope": {
                "run_id": "netskope-run", "status": "completed",
                "started_at": now - timedelta(minutes=3), "completed_at": now - timedelta(minutes=2),
            },
        }

    async def _detail(self, rows, runs, email="nadie@example.test"):
        snapshot = {"rows": rows, "runs": runs}
        with patch(
            "app.cross.services.person_client_coverage.get_person_client_coverage_snapshot",
            new=AsyncMock(return_value=snapshot),
        ):
            return await get_person_client_coverage_detail(object(), email=email)

    async def test_address_outside_the_identity_population_is_not_applicable_with_fresh_sources(self):
        detail = await self._detail([], self._runs())
        self.assertEqual(detail["status"], "not_applicable")
        self.assertEqual(detail["devices_total"], 0)
        self.assertIn("no pertenece a la población elegible", detail["explanation"])

    async def test_address_outside_the_population_is_unknown_when_a_source_is_not_fresh(self):
        detail = await self._detail([], self._runs(age_hours=48))
        self.assertEqual(detail["status"], "unknown")
        self.assertNotEqual(detail["status"], "not_applicable")

    async def test_every_detail_branch_returns_exactly_the_published_response_fields(self):
        published = set(PersonClientCoverageDetail.model_fields)
        empty = await self._detail([], self._runs())
        classified = await self._detail(
            [person("ada@example.test", recent=1, not_recent=1)], self._runs(), email="ada@example.test",
        )
        self.assertEqual(classified["status"], "partial")
        for payload in (empty, classified):
            self.assertEqual(set(payload), published)
            self.assertIn("devices_not_recent", payload)
            self.assertNotIn("devices_stale", payload)
