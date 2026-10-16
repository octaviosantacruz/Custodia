import asyncio
import unittest
from unittest.mock import patch

from app.cyberark.pam.services.pam_source import fetch_pam_source, gather_or_cancel, get_components_detail


class FakeClient:
    """Minimal async CyberArkClient stand-in covering every fetch_pam_source call."""

    def __init__(self):
        self.calls: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    async def get_users(self):
        self.calls.append("get_users")
        return [{"UUID": "u1", "username": "user"}], 1

    async def get_user_groups(self, page_size=100):
        self.calls.append("get_user_groups")
        return [], 0

    async def get_platforms(self):
        self.calls.append("get_platforms")
        return [{"general": {"id": "WinDomain", "name": "Windows Domain"}}], 1

    async def get_accounts(self, page_size=100):
        self.calls.append("get_accounts")
        return [], 0

    async def get_platform_targets(self):
        self.calls.append("get_platform_targets")
        return [{"ID": 1, "Name": "T1"}], 1

    async def get_platform_dependents(self):
        self.calls.append("get_platform_dependents")
        return [{"ID": 2, "Name": "D1"}], 1

    async def get_platform_groups(self):
        self.calls.append("get_platform_groups")
        return [], 0

    async def get_platform_rotational_groups(self):
        self.calls.append("get_platform_rotational_groups")
        return [], 0

    async def get_psm_servers(self):
        self.calls.append("get_psm_servers")
        return [{"ID": "PSMServer_01", "Name": "n", "Address": "10.0.0.1"}], 1

    async def get_psm_connectors(self):
        self.calls.append("get_psm_connectors")
        return [{"ID": "PSM-RDP", "DisplayName": ""}], 1

    async def get_components_summary(self):
        self.calls.append("get_components_summary")
        return {"Components": [{"ComponentID": "PVWA", "ComponentName": "PVWA"}]}

    async def get_component_detail(self, component_id):
        self.calls.append(f"get_component_detail:{component_id}")
        return [{"ComponentVersion": "14.2", "IsLoggedOn": True, "LastLogonDate": 1725900000}]

    async def get_platform_detail(self, platform_id):
        self.calls.append(f"get_platform_detail:{platform_id}")
        return {"PlatformID": platform_id, "Details": {"AllowedSafes": "^Win-"}}


class PamSourceAcquisitionTests(unittest.TestCase):
    def test_parallel_fetch_cancels_and_waits_for_siblings_after_a_failure(self):
        cancelled = asyncio.Event()
        never = asyncio.Event()

        async def blocked():
            try:
                await never.wait()
            finally:
                cancelled.set()

        async def failed():
            await asyncio.sleep(0)
            raise RuntimeError("simulated PAM failure")

        async def run():
            with self.assertRaisesRegex(RuntimeError, "simulated PAM failure"):
                await gather_or_cancel(blocked(), failed())
            self.assertTrue(cancelled.is_set())

        asyncio.run(run())

    def test_fetch_pam_source_populates_every_technical_catalog(self):
        fake_client = FakeClient()
        settings = object()
        with patch("app.cyberark.pam.services.pam_source.CyberArkSettings") as settings_cls, \
             patch("app.cyberark.pam.services.pam_source.CyberArkClient", return_value=fake_client):
            settings_cls.from_environment.return_value = settings
            snapshot = asyncio.run(fetch_pam_source(page_size=100))

        self.assertEqual(snapshot.platform_targets, [{"ID": 1, "Name": "T1"}])
        self.assertEqual(snapshot.platform_dependents, [{"ID": 2, "Name": "D1"}])
        self.assertEqual(snapshot.platform_groups, [])
        self.assertEqual(snapshot.platform_rotational_groups, [])
        self.assertEqual(snapshot.psm_servers[0]["Address"], "10.0.0.1")
        self.assertEqual(snapshot.psm_connectors[0]["ID"], "PSM-RDP")
        self.assertEqual(snapshot.components_summary["Components"][0]["ComponentID"], "PVWA")
        self.assertEqual(snapshot.components_detail["PVWA"][0]["ComponentVersion"], "14.2")
        self.assertEqual(snapshot.platform_details["WinDomain"]["allowed_safes_pattern"], "^Win-")
        self.assertIn("get_component_detail:PVWA", fake_client.calls)

    def test_second_parallel_phase_cancels_siblings_before_client_closes(self):
        cancelled = asyncio.Event()
        never = asyncio.Event()

        class Client(FakeClient):
            def __init__(self):
                super().__init__()
                self.siblings_cancelled_when_closed = False

            async def __aexit__(self, *exc):
                self.siblings_cancelled_when_closed = cancelled.is_set()

        async def failed_group_details(client, groups):
            await asyncio.sleep(0)
            raise RuntimeError("group detail failure")

        async def blocked_platform_details(client, platforms):
            try:
                await never.wait()
            finally:
                cancelled.set()

        async def components_detail(client, component_ids):
            return {}

        client = Client()
        with patch("app.cyberark.pam.services.pam_source.CyberArkSettings") as settings_cls, \
             patch("app.cyberark.pam.services.pam_source.CyberArkClient", return_value=client), \
             patch("app.cyberark.pam.services.pam_source.get_group_details", new=failed_group_details), \
             patch("app.cyberark.pam.services.pam_source.get_platform_details", new=blocked_platform_details), \
             patch("app.cyberark.pam.services.pam_source.get_components_detail", new=components_detail):
            settings_cls.from_environment.return_value = object()
            with self.assertRaisesRegex(RuntimeError, "group detail failure"):
                asyncio.run(fetch_pam_source())

        self.assertTrue(client.siblings_cancelled_when_closed)


class ComponentsDetailTests(unittest.TestCase):
    def test_fetches_detail_for_every_observed_component_id(self):
        class Client:
            async def get_component_detail(self, component_id):
                return [{"id": component_id}]

        result = asyncio.run(get_components_detail(Client(), ["PVWA", "CPM", ""]))
        self.assertEqual(set(result), {"PVWA", "CPM"})

    def test_returns_empty_dict_for_no_component_ids(self):
        result = asyncio.run(get_components_detail(object(), []))
        self.assertEqual(result, {})

    def test_rejects_invalid_concurrency(self):
        with self.assertRaises(ValueError):
            asyncio.run(get_components_detail(object(), ["PVWA"], max_concurrency=0))


if __name__ == "__main__":
    unittest.main()
