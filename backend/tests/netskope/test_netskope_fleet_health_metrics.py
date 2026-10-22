"""Fleet-health cards: counts come from the fleet reading, and a missing baseline is null, never zero."""

import unittest
from unittest.mock import AsyncMock, patch

from app.netskope.sse.metric_contracts import FLEET_FIELDS, inventory_metric_fields
from app.netskope.sse.repositories.netskope_metrics import _fleet_health

FLEET = "app.netskope.sse.repositories.netskope_fleet_groups.get_netskope_fleet_groups"
SUMMARY = {"devices": 100, "signal_24h": 80, "client_current": 30, "client_evaluated": 90,
           "os_supported": 70, "os_evaluated": 95, "on_prem": 20, "location_reported": 60}


class FleetHealthTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_selection_carries_each_card_and_its_denominator(self):
        fields = inventory_metric_fields(["fleet_client_current"])
        self.assertEqual(fields & FLEET_FIELDS, {"fleet_client_current", "fleet_client_evaluated"})
        fields = inventory_metric_fields(["devices_duplicate_hostnames"])
        self.assertEqual(fields, {"devices_duplicate_hostnames", "devices_total"})

    async def test_values_come_from_the_fleet_summary(self):
        fleet = {"summary": SUMMARY, "client_baseline": True, "os_baseline": True}
        with patch(FLEET, new=AsyncMock(return_value=fleet)):
            result = await _fleet_health(object(), frozenset({"fleet_signal_24h", "fleet_devices"}))
        self.assertEqual((result["fleet_devices"], result["fleet_signal_24h"], result["fleet_on_prem"], result["fleet_location_reported"]), (100, 80, 20, 60))
        self.assertEqual((result["fleet_client_current"], result["fleet_client_evaluated"], result["fleet_os_supported"]), (30, 90, 70))

    async def test_without_a_baseline_the_comparison_is_null_never_zero(self):
        fleet = {"summary": {**SUMMARY, "client_current": 0, "client_evaluated": 0, "os_supported": 0, "os_evaluated": 0}, "client_baseline": False, "os_baseline": False}
        with patch(FLEET, new=AsyncMock(return_value=fleet)):
            result = await _fleet_health(object(), frozenset({"fleet_client_current", "fleet_client_evaluated"}))
        for key in ("fleet_client_current", "fleet_client_evaluated", "fleet_os_supported", "fleet_os_evaluated"):
            self.assertIsNone(result[key], key)

    async def test_nothing_is_read_for_unrelated_widgets(self):
        fleet = AsyncMock()
        with patch(FLEET, new=fleet):
            self.assertEqual(await _fleet_health(object(), frozenset({"devices_total"})), {})
        fleet.assert_not_awaited()

    async def test_duplicate_hostnames_count_devices_in_repeated_groups(self):
        fetch = AsyncMock(return_value={"devices": 7})
        with patch("app.netskope.sse.repositories.netskope_metrics.fetch_one", new=fetch):
            result = await _fleet_health(object(), frozenset({"devices_duplicate_hostnames"}))
        self.assertEqual(result, {"devices_duplicate_hostnames": 7})
        self.assertIn("HAVING count(*) > 1", fetch.await_args.args[1])


if __name__ == "__main__":
    unittest.main()
