import unittest
from unittest.mock import AsyncMock, patch

from app.cyberark.pam.services import safe_classification as service


class _ForeignKeyViolation(Exception):
    sqlstate = "23503"


class SafeClassificationServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_foreign_key_violation_becomes_catalog_reference_error(self):
        with patch.object(service, "is_foreign_key_violation", return_value=True), \
             patch.object(service, "update_safe_metadata", new=AsyncMock(side_effect=_ForeignKeyViolation())):
            with self.assertRaises(service.CatalogReferenceError):
                await service.update_metadata(object(), 1, object(), "actor")

    async def test_other_errors_are_not_swallowed(self):
        with patch.object(service, "is_foreign_key_violation", return_value=False), \
             patch.object(service, "bulk_update_safe_assignment", new=AsyncMock(side_effect=RuntimeError("boom"))):
            with self.assertRaises(RuntimeError):
                await service.bulk_assign_safes(object(), object(), "actor")

    async def test_not_found_is_returned_as_none_and_actor_is_forwarded(self):
        mutation = AsyncMock(return_value=None)
        with patch.object(service, "update_safe_scope", new=mutation):
            self.assertIsNone(await service.set_scope("pool", 7, "payload", "actor"))
        mutation.assert_awaited_once_with("pool", 7, "payload", "actor")

    async def test_retired_candidates_never_enable_deletion(self):
        with patch.object(service, "get_retired_candidates", new=AsyncMock(return_value=[{"a": 1}])), \
             patch.object(service, "count_retired_candidates", new=AsyncMock(return_value=1)):
            self.assertEqual(
                await service.retired_candidates("pool", 10),
                {"rows": [{"a": 1}], "total": 1, "deletion_enabled": False},
            )


if __name__ == "__main__":
    unittest.main()
