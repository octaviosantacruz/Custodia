import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.cyberark.pam.repositories.pam_cleanup_queries import (
    FACTORY_GROUP_LABELS,
    get_pam_cleanup_signals,
)


class PamCleanupQueryEnvelopeTests(unittest.TestCase):
    def test_maps_all_signal_buckets_and_marks_only_verified_factory_names(self):
        computed_at = datetime(2026, 10, 1, tzinfo=timezone.utc)
        database_rows = [
            {
                "signal": "empty_groups", "count": 2, "denominator": 4,
                "items": [
                    {"object_id": 1, "display_name": "PSMMaster", "source_id": "factory-1", "reason": "vacío"},
                    {"object_id": 2, "display_name": "Custom group", "source_id": "role-2", "reason": "vacío"},
                ], "computed_at": computed_at, "inventory_runs": [],
            },
            *[
                {"signal": key, "count": 0, "denominator": 0, "items": [], "computed_at": computed_at, "inventory_runs": []}
                for key in (
                    "identical_member_groups", "redundant_groups_with_access_peer", "orphan_psm",
                    "platforms_without_accounts", "safes_without_active_users",
                )
            ],
        ]
        with patch("app.cyberark.pam.repositories.pam_cleanup_queries.fetch_all", new=AsyncMock(return_value=database_rows)) as fetch:
            result = asyncio.run(get_pam_cleanup_signals(object()))

        self.assertEqual(set(result), {row["signal"] for row in database_rows})
        self.assertEqual(result["empty_groups"]["count"], 2)
        self.assertEqual(result["empty_groups"]["denominator"], 4)
        self.assertEqual(result["empty_groups"]["computed_at"], computed_at)
        self.assertEqual(result["empty_groups"]["items"][0]["factory_label"], FACTORY_GROUP_LABELS["PSMMaster"])
        self.assertTrue(result["empty_groups"]["items"][0]["is_factory"])
        self.assertIn("no se sugiere su baja automática", result["empty_groups"]["items"][0]["reason"])
        self.assertFalse(result["empty_groups"]["items"][1]["is_factory"])
        self.assertIsNone(result["empty_groups"]["items"][1]["factory_label"])
        fetch.assert_awaited_once()
        self.assertEqual(fetch.await_args.args[2], ("cyberark",))


if __name__ == "__main__":
    unittest.main()
