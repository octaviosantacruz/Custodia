"""CHAIN-010: person view resolution, per-tool summaries and source visibility."""

import asyncio
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

from app.cross.api.routes.chains_person import _readable_sources
from app.cross.repositories.person_chain_queries import (
    PERSON_SEARCH_LIMIT,
    _person_name,
    get_person_summary,
    search_person_candidates,
)


def _fetch_by_source(rows_by_source: dict[str, list[dict]]):
    calls: list[str] = []

    async def fake_fetch(pool, sql, params):
        calls.append(params[0])
        return rows_by_source.get(params[0], [])

    return fake_fetch, calls


class PersonSearchTests(unittest.TestCase):
    def test_same_name_different_email_is_two_people(self):
        fetch, calls = _fetch_by_source({
            "cyberark": [{"name": "Ada Lovelace", "email": "ada@example.com"}],
            "identity_administration": [
                {"name": "Ada Lovelace", "email": "ada@example.com"},
                {"name": "Ada Lovelace", "email": "ada2@example.com"},
            ],
            "netskope": [{"name": "Ada", "email": " ADA@Example.com "}],
        })
        with patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fetch)):
            result = asyncio.run(search_person_candidates(
                object(), query="ad", sources={"pam", "identity", "netskope"},
            ))

        self.assertEqual(calls, ["cyberark", "identity_administration", "netskope"])
        self.assertEqual([person["email"] for person in result["people"]], ["ada2@example.com", "ada@example.com"])
        self.assertEqual(result["people"][1]["sources"], ["pam", "identity", "netskope"])
        self.assertEqual(result["people"][0]["sources"], ["identity"])

    def test_unreadable_sources_are_never_queried(self):
        fetch, calls = _fetch_by_source({"netskope": [{"name": "Ada", "email": "ada@example.com"}]})
        with patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fetch)):
            result = asyncio.run(search_person_candidates(object(), query="ad", sources={"netskope"}))

        self.assertEqual(calls, ["netskope"])
        self.assertEqual(result["people"][0]["sources"], ["netskope"])

    def test_service_and_tenant_emails_never_resolve(self):
        fetch, _ = _fetch_by_source({
            "cyberark": [
                {"name": "Sin arroba", "email": "cyberark.cloud.23356"},
                {"name": "Tenant", "email": "svc@cyberark.cloud.23356"},
                {"name": "Ada", "email": "ada@example.com"},
            ],
        })
        with patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fetch)):
            result = asyncio.run(search_person_candidates(object(), query="ad", sources={"pam"}))

        self.assertEqual([person["email"] for person in result["people"]], ["ada@example.com"])

    def test_search_caps_the_number_of_people(self):
        rows = [{"name": f"Persona {index:02d}", "email": f"p{index:02d}@example.com"} for index in range(30)]
        fetch, _ = _fetch_by_source({"netskope": rows})
        with patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fetch)):
            result = asyncio.run(search_person_candidates(object(), query="p", sources={"netskope"}))

        self.assertEqual(len(result["people"]), PERSON_SEARCH_LIMIT)

    def test_search_sql_excludes_service_users_and_the_tenant_domain(self):
        captured: dict[str, str] = {}

        async def fake_fetch(pool, sql, params):
            captured[params[0]] = sql
            return []

        with patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fake_fetch)):
            asyncio.run(search_person_candidates(
                object(), query="ad", sources={"pam", "identity", "netskope"},
            ))

        self.assertIn("EPVUser", captured["cyberark"])
        self.assertIn("'cyberark.cloud'", captured["cyberark"])
        self.assertIn("service_user", captured["identity_administration"])
        self.assertIn("'cyberark.cloud'", captured["identity_administration"])
        self.assertIn("'cyberark.cloud'", captured["netskope"])
        for sql in captured.values():
            self.assertNotIn("user_key", sql)
        self.assertIn("u.display_name ILIKE %s", captured["cyberark"])
        self.assertIn("o.display_name ILIKE %s", captured["netskope"])


class PersonSummaryTests(unittest.TestCase):
    def _run(self, *, sources, fetch_all_result=None, fetch_one_result=None, **patches):
        async def fake_fetch_all(pool, sql, params):
            return fetch_all_result if fetch_all_result is not None else []

        async def fake_fetch_one(pool, sql, params):
            return fetch_one_result

        stack = [
            patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fake_fetch_all)),
            patch("app.cross.repositories.person_chain_queries.fetch_one", new=AsyncMock(side_effect=fake_fetch_one)),
        ]
        mocks = {}
        for name, value in patches.items():
            mock = AsyncMock(return_value=value)
            stack.append(patch(f"app.cross.repositories.person_chain_queries.{name}", new=mock))
            mocks[name] = mock
        with ExitStack() as exit_stack:
            for item in stack:
                exit_stack.enter_context(item)
            result = asyncio.run(get_person_summary(object(), email="ada@example.com", sources=sources))
        return result, mocks

    def test_only_readable_tools_are_returned(self):
        candidate = {"object_id": 3, "display_name": "Ada", "source_id": "u-3", "attributes": {"email": "ada@example.com"}, "email": "ada@example.com", "company": "ITTI"}
        result, mocks = self._run(
            sources={"netskope"},
            fetch_all_result=[candidate],
            user_matched_device_summary={"device_count": 2, "stale_device_count": 1, "client_versions": ["110.0.1"], "operating_systems": ["Windows"]},
        )

        self.assertEqual(set(result["tools"]), {"netskope"})
        self.assertEqual(result["tools"]["netskope"]["status"], "matched")
        self.assertEqual(result["tools"]["netskope"]["basis"], "email_exact")
        self.assertEqual(result["tools"]["netskope"]["device_count"], 2)
        self.assertEqual(result["tools"]["netskope"]["stale_device_count"], 1)
        self.assertEqual(result["tools"]["netskope"]["client_versions"], ["110.0.1"])
        self.assertEqual(result["tools"]["netskope"]["company"], "ITTI")
        mocks["user_matched_device_summary"].assert_awaited_once()

    def test_pam_matched_publishes_totals_and_user_flags(self):
        candidate = {
            "object_id": 9, "display_name": "Ada", "source_id": "ada@example.com",
            "attributes": {"user_type": "EPVUser", "suspended": "true"},
        }
        totals = {"roles": 3, "safes": 5, "platforms": 4, "psms": 2, "accounts": 10}
        result, mocks = self._run(
            sources={"pam"},
            fetch_all_result=[candidate],
            get_pam_chain_for_user={"totals": totals},
        )

        pam = result["tools"]["pam"]
        self.assertEqual(pam["status"], "matched")
        self.assertEqual(pam["user"]["user_type"], "EPVUser")
        self.assertTrue(pam["user"]["suspended"])
        self.assertEqual(pam["totals"], totals)
        mocks["get_pam_chain_for_user"].assert_awaited_once()

    def test_pam_ambiguity_never_publishes_data(self):
        rows = [
            {"object_id": 9, "display_name": "Ada", "source_id": "ada@example.com", "attributes": {}},
            {"object_id": 10, "display_name": "Ada 2", "source_id": "ada@example.com", "attributes": {}},
        ]
        result, mocks = self._run(sources={"pam"}, fetch_all_result=rows, get_pam_chain_for_user={"totals": {}})

        self.assertEqual(result["tools"]["pam"]["status"], "ambiguous")
        self.assertIsNone(result["tools"]["pam"].get("user"))
        mocks["get_pam_chain_for_user"].assert_not_awaited()

    def test_identity_summary_reports_roles_and_federation(self):
        candidate = {
            "object_id": 12, "display_name": "Ada", "source_id": "uuid-1",
            "attributes": {"email": "ada@itti.digital", "active": True, "service_user": False, "last_login_date": "2026-09-01T00:00:00Z"},
        }
        federation = {"object_id": 63, "display_name": "Okta ITTI", "source_id": "fed-1", "active": True}
        result, mocks = self._run(
            sources={"identity"},
            fetch_all_result=[candidate],
            fetch_one_result={"total": 4},
            list_active_federations=[federation],
        )

        identity = result["tools"]["identity"]
        self.assertEqual(identity["status"], "matched")
        self.assertTrue(identity["user"]["active"])
        self.assertEqual(identity["role_count"], 4)
        self.assertEqual(identity["federation"]["display_name"], "Okta ITTI")
        self.assertEqual(result["name"], "Ada")

    def _role_access_run(self, sources, pam_rows):
        identity_row = {
            "object_id": 12, "display_name": "Ada", "source_id": "uuid-1",
            "attributes": {"email": "ada@itti.digital", "active": True},
        }

        async def fake_fetch_all(pool, sql, params):
            return pam_rows if params[0] == "cyberark" else [identity_row]

        role_access = AsyncMock(return_value={"basis": "role_name_exact", "matched_roles": 1, "ambiguous_roles": 0, "safes": 4})
        with ExitStack() as stack:
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fake_fetch_all)))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.fetch_one", new=AsyncMock(return_value={"total": 1})))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.list_active_federations", new=AsyncMock(return_value=[])))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.get_pam_chain_for_user", new=AsyncMock(return_value={"totals": {}})))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.pam_access_through_identity_roles", new=role_access))
            result = asyncio.run(get_person_summary(object(), email="ada@itti.digital", sources=sources))
        return result, role_access

    def test_role_access_is_added_only_without_a_pam_user_and_with_identity_readable(self):
        # Sanctioned exception (2026-10-05): no PAM user of their own, a matched Identity user.
        result, role_access = self._role_access_run({"pam", "identity"}, [])
        self.assertEqual(result["tools"]["pam"]["status"], "unmatched")
        self.assertEqual(result["tools"]["pam"]["role_access"]["safes"], 4)
        role_access.assert_awaited_once_with(unittest.mock.ANY, 12)

        # A person with their own PAM user keeps the confirmed chain; no role inference.
        pam_user = [{"object_id": 9, "display_name": "Ada", "source_id": "ada@itti.digital", "attributes": {}}]
        result, role_access = self._role_access_run({"pam", "identity"}, pam_user)
        self.assertNotIn("role_access", result["tools"]["pam"])
        role_access.assert_not_awaited()

        # Without Identity read permission the roles are not consulted at all.
        result, role_access = self._role_access_run({"pam"}, [])
        self.assertNotIn("role_access", result["tools"]["pam"])
        role_access.assert_not_awaited()

        # An ambiguous PAM match never gets role access either.
        twins = pam_user + [{"object_id": 10, "display_name": "Ada 2", "source_id": "ada@itti.digital", "attributes": {}}]
        result, role_access = self._role_access_run({"pam", "identity"}, twins)
        self.assertEqual(result["tools"]["pam"]["status"], "ambiguous")
        role_access.assert_not_awaited()

    def _sia_run(self, sources, pam_rows, identity_rows):
        async def fake_fetch_all(pool, sql, params):
            return pam_rows if params[0] == "cyberark" else identity_rows

        access = {"basis": "grantee_name_exact", "user_policies": 1, "role_policies": 2, "policies": 3,
                  "matched_roles": 1, "ambiguous_roles": 0}
        sia_access = AsyncMock(return_value=access)
        with ExitStack() as stack:
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.fetch_all", new=AsyncMock(side_effect=fake_fetch_all)))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.fetch_one", new=AsyncMock(return_value={"total": 1})))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.list_active_federations", new=AsyncMock(return_value=[])))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.get_pam_chain_for_user", new=AsyncMock(return_value={"totals": {}})))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.pam_access_through_identity_roles", new=AsyncMock(return_value={"basis": "role_name_exact", "matched_roles": 0, "ambiguous_roles": 0, "safes": 0})))
            stack.enter_context(patch("app.cross.repositories.person_chain_queries.sia_access_for_person", new=sia_access))
            result = asyncio.run(get_person_summary(object(), email="ada@itti.digital", sources=sources))
        return result, sia_access

    IDENTITY_ROW = {"object_id": 12, "display_name": "Ada", "source_id": "uuid-1", "attributes": {"email": "ada@itti.digital"}}
    PAM_ROW = {"object_id": 9, "display_name": "ada@itti.digital", "source_id": "ada@itti.digital", "attributes": {}}

    def test_sia_needs_a_resolved_pam_or_identity_user(self):
        result, sia_access = self._sia_run({"pam", "sia"}, [], [])
        self.assertEqual(result["tools"]["pam"]["status"], "unmatched")
        self.assertNotIn("sia", result["tools"])
        sia_access.assert_not_awaited()

    def test_sia_counts_policies_through_identity_even_without_a_pam_user(self):
        # Sanctioned exception (2026-10-05): user name and Identity roles, exact names only.
        result, sia_access = self._sia_run({"pam", "identity", "sia"}, [], [self.IDENTITY_ROW])
        self.assertEqual(result["tools"]["sia"]["status"], "reference")
        self.assertEqual(result["tools"]["sia"]["policy_count"], 3)
        self.assertEqual(result["tools"]["sia"]["sia_access"]["role_policies"], 2)
        sia_access.assert_awaited_once_with(unittest.mock.ANY, identity_user_object_id=12, pam_user_name=None)

    def test_sia_uses_both_names_when_both_users_resolve(self):
        _, sia_access = self._sia_run({"pam", "identity", "sia"}, [self.PAM_ROW], [self.IDENTITY_ROW])
        sia_access.assert_awaited_once_with(unittest.mock.ANY, identity_user_object_id=12, pam_user_name="ada@itti.digital")

    def test_sia_without_identity_permission_never_reads_identity_roles(self):
        _, sia_access = self._sia_run({"pam", "sia"}, [self.PAM_ROW], [self.IDENTITY_ROW])
        sia_access.assert_awaited_once_with(unittest.mock.ANY, identity_user_object_id=None, pam_user_name="ada@itti.digital")


class ReadableSourcesTests(unittest.TestCase):
    def test_permission_combinations(self):
        self.assertEqual(_readable_sources(["sia:catalogs_read"]), {"sia"})
        self.assertEqual(_readable_sources(["pam:catalogs_read"]), {"pam"})
        self.assertEqual(_readable_sources(["identity:catalogs_read"]), {"identity"})
        self.assertEqual(_readable_sources(["netskope:read"]), {"netskope"})
        self.assertEqual(_readable_sources(["pam:catalogs_read", "sia:catalogs_read"]), {"pam", "sia"})
        self.assertEqual(_readable_sources(["access:manage"]), {"pam", "identity", "netskope", "sia"})


if __name__ == "__main__":
    unittest.main()


class PersonNameTests(unittest.TestCase):
    """The centre of the person view shows a name, never the email twice."""

    def _matched(self, name):
        return {"status": "matched", "user": {"display_name": name}}

    def test_identity_name_wins_over_a_pam_login_email(self):
        tools = {
            "pam": self._matched("ada@itti.digital"),
            "identity": self._matched("Ada Lovelace"),
            "netskope": self._matched("Ada Netskope"),
        }
        self.assertEqual(_person_name(tools), "Ada Lovelace")

    def test_falls_back_to_netskope_then_to_a_pam_name_without_email_shape(self):
        self.assertEqual(_person_name({"pam": self._matched("ada@itti.digital"), "netskope": self._matched("Ada N")}), "Ada N")
        self.assertEqual(_person_name({"pam": self._matched("Ada PAM")}), "Ada PAM")

    def test_only_email_shaped_or_unmatched_names_give_no_name(self):
        tools = {
            "pam": self._matched("ada@itti.digital"),
            "identity": {"status": "ambiguous"},
            "netskope": {"status": "unmatched"},
        }
        self.assertEqual(_person_name(tools), "")
