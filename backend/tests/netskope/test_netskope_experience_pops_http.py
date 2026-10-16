"""The experience POP route is read-only, authorized and window-bounded."""

import unittest
import time
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import httpx

from tests.cross.test_permission_http_matrix import _AuthenticatedSession, app


class NetskopeExperiencePopsHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_reader_receives_only_pop_codes_and_bounded_window(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        remote = AsyncMock(return_value=["AR-BUE1", "BR-SAO1"])
        before = int(time.time())
        with patch("app.netskope.sse.api.routes.cmdb_netskope.NetskopeSettings.from_environment"), \
                patch("app.netskope.sse.api.routes.cmdb_netskope.NetskopeClient") as client_class:
            client_class.return_value.__aenter__.return_value.get_adem_pops = remote
            response = await self.client.get("/api/cmdb/netskope/experience/pops", params={"hours": 24})
        after = int(time.time())
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["pops"], ["AR-BUE1", "BR-SAO1"])
        self.assertEqual(payload["total"], 2)
        self.assertGreaterEqual(payload["window_end"], before)
        self.assertLessEqual(payload["window_end"], after)
        self.assertEqual(payload["window_start"], payload["window_end"] - 24 * 3600)
        remote.assert_awaited_once_with(payload["window_start"], payload["window_end"])

    async def test_invalid_window_and_missing_permission_never_call_netskope(self):
        self.session.set_permissions(["inventory:read", "netskope:read"])
        with patch("app.netskope.sse.api.routes.cmdb_netskope.NetskopeSettings.from_environment") as settings:
            invalid = await self.client.get("/api/cmdb/netskope/experience/pops", params={"hours": 72})
            self.assertEqual(invalid.status_code, 422)
            self.session.set_permissions(["inventory:read"])
            denied = await self.client.get("/api/cmdb/netskope/experience/pops", params={"hours": 24})
            self.assertEqual(denied.status_code, 403)
        settings.assert_not_called()

    async def test_user_device_detail_keeps_window_and_flags_outside_activity(self):
        self.session.set_permissions(['inventory:read', 'netskope:read'])
        end = int(time.time()) - 10
        start = end - 7200
        devices = AsyncMock(return_value=[{'device_id': 'opaque:70', 'device_name': 'Laptop', 'device_os': 'Linux'}])
        detail = AsyncMock(return_value={'pop': 'AR-BUE1', 'last_activity': end + 1421})
        with patch('app.netskope.sse.api.routes.cmdb_netskope_experience.get_experience_user', new=AsyncMock(return_value={'email': 'person@example.test'})), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeSettings.from_environment'), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeClient') as client_class:
            client = client_class.return_value.__aenter__.return_value
            client.get_adem_devices = devices
            client.get_adem_device_details = detail
            listing = await self.client.get('/api/cmdb/netskope/users/1/experience/devices?hours=2')
            response = await self.client.get('/api/cmdb/netskope/users/1/experience/devices/opaque:70', params={'window_start': start, 'window_end': end})
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json()['devices'][0]['device_id'], 'opaque:70')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'device_id': 'opaque:70', 'pop': 'AR-BUE1', 'last_activity': end + 1421,
                                         'window_start': start, 'window_end': end, 'source': 'netskope_adem', 'activity_status': 'outside_window'})
        detail.assert_awaited_once_with('person@example.test', 'opaque:70', start, end)

    async def test_user_experience_denies_permission_before_inventory_or_remote_read(self):
        self.session.set_permissions(['inventory:read'])
        with patch('app.netskope.sse.api.routes.cmdb_netskope_experience.get_experience_user', new=AsyncMock()) as user:
            for path in ('/api/cmdb/netskope/users/1/experience/devices?hours=2',
                         '/api/cmdb/netskope/users/1/experience/devices/id?window_start=1&window_end=2'):
                response = await self.client.get(path)
                self.assertEqual(response.status_code, 403, response.text)
            user.assert_not_awaited()

    async def test_detail_rejects_unobserved_device_and_sanitizes_remote_error(self):
        from app.netskope.sse.integrations.netskope import NetskopeError
        self.session.set_permissions(['inventory:read', 'netskope:read'])
        end = int(time.time()) - 10
        params = {'window_start': end - 7200, 'window_end': end}
        with patch('app.netskope.sse.api.routes.cmdb_netskope_experience.get_experience_user', new=AsyncMock(return_value={'email': 'person@example.test'})), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeSettings.from_environment'), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeClient') as client_class:
            client = client_class.return_value.__aenter__.return_value
            client.get_adem_devices = AsyncMock(return_value=[])
            client.get_adem_device_details = AsyncMock()
            missing = await self.client.get('/api/cmdb/netskope/users/1/experience/devices/other', params=params)
            self.assertEqual(missing.status_code, 404, missing.text)
            client.get_adem_device_details.assert_not_awaited()
            client.get_adem_devices.side_effect = NetskopeError('HTTP 403 person@example.test privateIp=secret')
            failed = await self.client.get('/api/cmdb/netskope/users/1/experience/devices?hours=2')
            self.assertEqual(failed.status_code, 502)
            self.assertNotIn('person@example.test', failed.text)
            self.assertNotIn('privateIp', failed.text)

    async def test_invalid_window_and_unknown_user_do_not_call_adem(self):
        self.session.set_permissions(['inventory:read', 'netskope:read'])
        end = int(time.time())
        with patch('app.netskope.sse.api.routes.cmdb_netskope_experience.get_experience_user', new=AsyncMock(return_value=None)), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeClient') as remote:
            for params in ({'window_start': end - 49 * 3600, 'window_end': end},
                           {'window_start': end - 31 * 86400, 'window_end': end - 30 * 86400},
                           {'window_start': end, 'window_end': end + 7200}):
                response = await self.client.get('/api/cmdb/netskope/users/1/experience/devices/id', params=params)
                self.assertEqual(response.status_code, 422, response.text)
            missing = await self.client.get('/api/cmdb/netskope/users/1/experience/devices?hours=2')
            self.assertEqual(missing.status_code, 404)
            remote.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class NetskopeExperienceScoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        self.addAsyncCleanup(self.client.aclose)
        self.session = _AuthenticatedSession(self.stack, self.client)
        await self.session.login()

    async def test_score_names_the_weakest_component_and_caps_the_devices(self):
        self.session.set_permissions(['inventory:read', 'netskope:read'])
        devices = [{'device_id': f'd{n}', 'device_name': f'PC-{n}', 'device_os': 'Windows'} for n in range(7)]
        scores = {'d0': {'exp_score': 52, 'device_score': 96, 'network_score': 15, 'app_score': 100}}
        scores.update({f'd{n}': {'exp_score': None, 'device_score': None, 'network_score': None, 'app_score': 90} for n in range(1, 7)})
        async def device_scores(user, device_id, start, end):
            return scores[device_id]
        with patch('app.netskope.sse.api.routes.cmdb_netskope_experience.get_experience_user', new=AsyncMock(return_value={'email': 'person@example.test'})), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeSettings.from_environment'), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeClient') as client_class:
            client = client_class.return_value.__aenter__.return_value
            client.get_adem_user_score = AsyncMock(return_value=52)
            client.get_adem_devices = AsyncMock(return_value=devices)
            client.get_adem_device_scores = device_scores
            with patch('app.netskope.sse.api.routes.cmdb_netskope_experience.list_user_inventory_device_names', new=AsyncMock(return_value=[{'object_id': 99, 'name': 'pc-0'}])):
                response = await self.client.get('/api/cmdb/netskope/users/1/experience/score?hours=24')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['score'], 52)
        self.assertEqual(body['weakest'], 'network')
        self.assertEqual(len(body['devices']), 5)
        self.assertEqual(body['devices_total'], 7)
        self.assertIsNone(body['devices'][1]['network_score'])
        self.assertEqual((body['devices'][0]['inventory_device_id'], body['devices'][1]['inventory_device_id']), (99, None))

    async def test_remote_failure_is_generic_and_permission_is_enforced(self):
        self.session.set_permissions(['inventory:read', 'netskope:read'])
        from app.netskope.sse.integrations.netskope import NetskopeError
        with patch('app.netskope.sse.api.routes.cmdb_netskope_experience.get_experience_user', new=AsyncMock(return_value={'email': 'person@example.test'})), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeSettings.from_environment'), \
                patch('app.netskope.sse.api.routes.cmdb_netskope_experience.NetskopeClient') as client_class:
            client_class.return_value.__aenter__.return_value.get_adem_user_score = AsyncMock(side_effect=NetskopeError('person@example.test 10.0.0.1'))
            failed = await self.client.get('/api/cmdb/netskope/users/1/experience/score')
            self.assertEqual(failed.status_code, 502)
            self.assertNotIn('person@example.test', failed.text)
            self.session.set_permissions(['inventory:read'])
            denied = await self.client.get('/api/cmdb/netskope/users/1/experience/score')
            self.assertEqual(denied.status_code, 403)
