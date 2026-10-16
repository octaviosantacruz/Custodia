"""NSK-POL-001: observed-policy shaping and availability semantics.

The service groups repository rows per window, orders by volume, exposes only
capture bounds (never event dates) and reports "Sin dato" for the dominant
action because the cross policy x action dimension was explicitly not built.
"""

from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import AsyncMock, patch

from app.netskope.sse.services.netskope_observed_policies import (
    DOMINANT_ACTION_UNKNOWN,
    get_observed_policies,
)


def _row(*, window_days, policy, count, captured_at, window_start=None, window_end=None, first=None, last=None, policy_captured=True):
    return {
        "policy_captured": policy_captured,
        "window_days": window_days,
        "policy": policy,
        "alert_count": count,
        "window_start": window_start or captured_at - timedelta(days=window_days),
        "window_end": window_end or captured_at,
        "captured_at": captured_at,
        "first_captured_at": first or captured_at,
        "last_captured_at": last or captured_at,
    }


class NetskopeObservedPoliciesServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_groups_by_window_orders_by_volume_and_labels_unknown_action(self):
        now = datetime.now(timezone.utc)
        older = now - timedelta(days=2)
        rows = [
            _row(window_days=7, policy="Baja", count=2, captured_at=now),
            _row(window_days=7, policy="Alta", count=9, captured_at=now, first=older, last=now),
            _row(window_days=30, policy="Alta", count=40, captured_at=now),
        ]
        with patch(
            "app.netskope.sse.services.netskope_observed_policies.fetch_observed_policy_rows",
            new=AsyncMock(return_value=rows),
        ):
            result = await get_observed_policies(AsyncMock())

        self.assertEqual([window["days"] for window in result["windows"]], [7, 30])
        seven = result["windows"][0]
        self.assertEqual([policy["policy"] for policy in seven["policies"]], ["Alta", "Baja"])
        self.assertEqual([policy["volume"] for policy in seven["policies"]], [9, 2])
        self.assertEqual(seven["policies"][0]["first_captured_at"], older)
        self.assertEqual(seven["policies"][0]["last_captured_at"], now)
        self.assertEqual(seven["policies"][0]["dominant_action"], DOMINANT_ACTION_UNKNOWN)
        self.assertEqual(seven["availability"], "complete")
        self.assertEqual(seven["policy_capture"], "captured")
        self.assertEqual(seven["window_start"], now - timedelta(days=7))
        self.assertEqual(seven["window_end"], now)

    async def test_absent_window_is_not_invented_and_stale_capture_is_reported(self):
        stale = datetime.now(timezone.utc) - timedelta(hours=25)
        rows = [_row(window_days=90, policy="Antigua", count=3, captured_at=stale)]
        with patch(
            "app.netskope.sse.services.netskope_observed_policies.fetch_observed_policy_rows",
            new=AsyncMock(return_value=rows),
        ):
            result = await get_observed_policies(AsyncMock())

        self.assertEqual([window["days"] for window in result["windows"]], [90])
        self.assertEqual(result["windows"][0]["availability"], "stale")
        # No 7/30 window means no data, never a fabricated zero row.
        self.assertEqual(len(result["windows"]), 1)

    async def test_empty_result_returns_no_windows(self):
        with patch(
            "app.netskope.sse.services.netskope_observed_policies.fetch_observed_policy_rows",
            new=AsyncMock(return_value=[]),
        ):
            result = await get_observed_policies(AsyncMock())
        self.assertEqual(result["windows"], [])
        self.assertEqual(result["retention_days"], 180)

    async def test_window_without_policy_capture_is_missing_not_empty(self):
        # NSK-POL-002: a cohort that never captured the dimension must not read
        # as "no policy fired".
        now = datetime.now(timezone.utc)
        rows = [_row(window_days=7, policy=None, count=None, captured_at=now, first=None, last=None, policy_captured=False)]
        with patch(
            "app.netskope.sse.services.netskope_observed_policies.fetch_observed_policy_rows",
            new=AsyncMock(return_value=rows),
        ):
            result = await get_observed_policies(AsyncMock())
        window = result["windows"][0]
        self.assertEqual((window["policy_capture"], window["policies"]), ("missing", []))

    async def test_captured_window_with_zero_policies_is_an_explicit_empty_list(self):
        now = datetime.now(timezone.utc)
        rows = [_row(window_days=7, policy=None, count=None, captured_at=now, first=None, last=None, policy_captured=True)]
        with patch(
            "app.netskope.sse.services.netskope_observed_policies.fetch_observed_policy_rows",
            new=AsyncMock(return_value=rows),
        ):
            result = await get_observed_policies(AsyncMock())
        window = result["windows"][0]
        self.assertEqual((window["policy_capture"], window["policies"]), ("captured", []))


if __name__ == "__main__":
    unittest.main()
