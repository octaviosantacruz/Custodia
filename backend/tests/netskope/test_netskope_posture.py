import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.netskope.sse.services import netskope_posture
from app.netskope.sse.services.netskope_posture import CHECK_IDS, get_netskope_posture

MODULE = "app.netskope.sse.services.netskope_posture"
SIGNAL = datetime(2026, 9, 1, tzinfo=timezone.utc)
BASELINES = {"client_golden_releases": {"value": {"releases": ["130.0.0", "129.0.0"]}}, "os_minimum_versions": {"value": {"minimums": {"Windows": "10.0.19045"}}}}
EVIDENCE = {"source_fresh": True, "source_status": "completed", "source_completed_at": SIGNAL, "as_of": SIGNAL}


def device_row(object_id=7):
    return {
        "object_id": object_id, "display_name": "LAPTOP-7", "source_id": "dev-7",
        "attributes": {"hostname": "LAPTOP-7", "username": "ana@example.com", "os": "Windows", "os_version": "10.0.19041",
                       "client_version": "128.0.0", "last_seen_event": "Uninstalled", "serial_number": "SECRET-SERIAL"},
        "device_evidence": {"last_signal_at": SIGNAL},
    }


class NetskopePostureTests(unittest.TestCase):
    def run_posture(self, *, baselines=BASELINES, permissions=frozenset(), uci_configured=True, total=3):
        objects = AsyncMock(return_value={"rows": [device_row()], "total": total})
        uci = AsyncMock(return_value={"rows": [{"email": "ana@example.com", "name": "Ana", "score": 420, "scored_at": SIGNAL}],
                                      "total": 1, "by_rating": {"Poor": 4, "Moderate": 9}, "captured_at": SIGNAL})
        self.baselines_reader = AsyncMock(return_value=baselines)
        with patch(f"{MODULE}.get_netskope_baselines", self.baselines_reader), \
             patch(f"{MODULE}.list_netskope_objects", objects), \
             patch(f"{MODULE}.list_netskope_user_uci", uci), \
             patch(f"{MODULE}.get_netskope_source_evidence", AsyncMock(return_value=EVIDENCE)), \
             patch(f"{MODULE}.netskope_uci_configured", return_value=uci_configured):
            result = asyncio.run(get_netskope_posture(object(), permissions))
        return result, objects, uci

    def test_each_device_check_is_the_inventory_query_its_drill_opens(self):
        result, objects, _ = self.run_posture()
        self.assertEqual(objects.await_count, len(netskope_posture.DEVICE_CHECKS))
        for call, check in zip(objects.await_args_list, netskope_posture.DEVICE_CHECKS, strict=True):
            with self.subTest(check=check["id"]):
                self.assertEqual(call.args[1], "device")
                self.assertEqual(call.kwargs["freshness"], "all")
                for key, value in check["query"].items():
                    self.assertEqual(call.kwargs[key], value)
                sent = {key: value for key, value in call.kwargs.items() if value and key != "freshness"}
                self.assertEqual(sent, check["query"])
        by_id = {check["id"]: check for check in result["checks"]}
        self.assertEqual(tuple(by_id), CHECK_IDS)
        self.assertEqual(by_id["client_protection_off"]["count"], 3)
        self.assertEqual(by_id["stale_undiagnosed"]["query"], {"event_age": "gt_30d", "review_diagnosis": "undetermined"})

    def test_findings_are_an_allowlisted_projection(self):
        result, _, _ = self.run_posture()
        finding = result["checks"][0]["findings"][0]
        self.assertEqual(finding, {
            "object_id": 7, "name": "LAPTOP-7", "user": "ana@example.com", "os": "Windows 10.0.19041",
            "client_version": "128.0.0", "last_event": "Uninstalled", "detected_at": SIGNAL,
        })
        self.assertNotIn("SECRET-SERIAL", repr(result))

    def test_version_policy_checks_are_deferred_not_shown_and_not_queried(self):
        # Golden releases and minimum OS versions wait for a policy (NSK-POLICY-001): Postura neither lists nor evaluates them.
        result, objects, _ = self.run_posture()
        ids = {check["id"] for check in result["checks"]}
        deferred = {check["id"] for check in netskope_posture.DEFERRED_POLICY_CHECKS}
        self.assertEqual(deferred, {"client_two_plus_behind", "os_below_minimum", "client_one_behind"})
        self.assertFalse(ids & deferred)
        self.assertFalse(deferred & set(netskope_posture.CHECK_IDS))
        sent = [call.kwargs for call in objects.await_args_list]
        self.assertFalse(any(kwargs["client_compliance"] or kwargs["os_compliance"] for kwargs in sent))

    def test_baselines_are_not_read_while_no_device_check_depends_on_one(self):
        self.run_posture()
        self.baselines_reader.assert_not_awaited()
        # A device check that does name a baseline still reads them (and reports not_configured without one).
        check = {"id": "needs_baseline", "severity": "low", "baseline": "client_golden_releases", "title": "t", "description": "d", "query": {}}
        with patch.object(netskope_posture, "DEVICE_CHECKS", (check,)):
            result, objects, _ = self.run_posture(baselines={"client_golden_releases": None})
        self.baselines_reader.assert_awaited_once()
        self.assertEqual(result["checks"][0]["status"], "not_configured")
        objects.assert_not_awaited()

    def test_uci_checks_need_the_strict_uba_permission(self):
        result, _, uci = self.run_posture(permissions=frozenset({"netskope:read", "access:manage"}))
        by_id = {check["id"]: check for check in result["checks"]}
        self.assertEqual((by_id["uci_poor"]["status"], by_id["uci_moderate"]["status"]), ("not_permitted", "not_permitted"))
        self.assertEqual(by_id["uci_poor"]["findings"], [])
        uci.assert_not_awaited()
        self.assertIsNone(result["uci_captured_at"])

    def test_uci_checks_count_by_rating_with_the_permission(self):
        result, _, uci = self.run_posture(permissions=frozenset({"netskope:read", "netskope:uba_read"}))
        by_id = {check["id"]: check for check in result["checks"]}
        self.assertEqual((by_id["uci_poor"]["count"], by_id["uci_moderate"]["count"]), (4, 9))
        self.assertEqual([call.args[1] for call in uci.await_args_list], ["Poor", "Moderate"])
        self.assertEqual(by_id["uci_poor"]["findings"][0]["score"], 420)
        self.assertEqual(result["uci_captured_at"], SIGNAL)

    def test_uci_checks_without_the_task_are_not_configured(self):
        result, _, uci = self.run_posture(permissions=frozenset({"netskope:uba_read"}), uci_configured=False)
        self.assertEqual({check["status"] for check in result["checks"] if check["entity"] == "user"}, {"not_configured"})
        uci.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
