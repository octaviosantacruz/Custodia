import unittest
from datetime import date
from unittest.mock import AsyncMock, patch

from app.cyberark.pam.services import catalog_admin, findings_management as findings


class CatalogAdminServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_unique_violation_becomes_duplicate_entry(self):
        with patch.object(catalog_admin, "is_unique_violation", return_value=True), \
             patch.object(catalog_admin, "create_business_unit", new=AsyncMock(side_effect=RuntimeError("dup"))):
            with self.assertRaises(catalog_admin.DuplicateCatalogEntryError):
                await catalog_admin.add_business_unit(object(), "IT", "IT", "admin")

    async def test_other_errors_propagate(self):
        with patch.object(catalog_admin, "is_unique_violation", return_value=False), \
             patch.object(catalog_admin, "update_responsible", new=AsyncMock(side_effect=RuntimeError("boom"))):
            with self.assertRaises(RuntimeError):
                await catalog_admin.change_responsible(object(), 1, object(), "admin")

    async def test_not_found_is_returned_as_none(self):
        with patch.object(catalog_admin, "update_business_unit", new=AsyncMock(return_value=None)):
            self.assertIsNone(await catalog_admin.change_business_unit(object(), 1, object(), "admin"))


class FindingsServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_finding_is_not_updated_or_audited(self):
        update, audit = AsyncMock(), AsyncMock()
        with patch.object(findings, "get_finding", new=AsyncMock(return_value=None)), \
             patch.object(findings, "update_finding", new=update), patch.object(findings, "record_audit", new=audit):
            with self.assertRaises(findings.FindingNotFoundError):
                await findings.review_finding(object(), 9, "resolved", None, None, "admin")
        update.assert_not_awaited()
        audit.assert_not_awaited()

    async def test_exception_requires_reason_before_any_write(self):
        update = AsyncMock()
        before = {"status": "open", "exception_reason": None}
        with patch.object(findings, "get_finding", new=AsyncMock(return_value=before)), patch.object(findings, "update_finding", new=update):
            with self.assertRaises(findings.ExceptionReasonRequiredError):
                await findings.review_finding(object(), 9, "excepted", "", date(2026, 12, 1), "admin")
        update.assert_not_awaited()

    async def test_update_is_audited_with_before_and_after(self):
        before = {"status": "open", "exception_reason": None}
        after = {"status": "excepted", "exception_reason": "aprobado"}
        audit = AsyncMock()
        with patch.object(findings, "get_finding", new=AsyncMock(return_value=before)), \
             patch.object(findings, "update_finding", new=AsyncMock(return_value=after)), patch.object(findings, "record_audit", new=audit):
            row = await findings.review_finding(object(), 9, "excepted", "aprobado", None, "admin")
        self.assertEqual(row, after)
        kwargs = audit.await_args.kwargs
        self.assertEqual((kwargs["actor_id"], kwargs["entity_id"]), ("admin", "9"))
        self.assertEqual(kwargs["before_data"]["status"], "open")
        self.assertEqual(kwargs["after_data"]["status"], "excepted")

    async def test_refresh_audits_the_count(self):
        audit = AsyncMock()
        with patch.object(findings, "refresh_findings", new=AsyncMock(return_value=4)), patch.object(findings, "record_audit", new=audit):
            self.assertEqual(await findings.refresh_current_findings(object(), "admin"), 4)
        self.assertEqual(audit.await_args.kwargs["after_data"], {"current_findings": 4})


if __name__ == "__main__":
    unittest.main()
