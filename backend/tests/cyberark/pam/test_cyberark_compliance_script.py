import asyncio
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch


SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "cyberark_compliance.py"
SPEC = importlib.util.spec_from_file_location("cyberark_compliance_script", SCRIPT)
compliance_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compliance_script)


class FakeClient:
    def __init__(self, accounts, overviews):
        self.accounts = accounts
        self.overviews = overviews
        self.paths = []

    async def get_accounts(self):
        return self.accounts, len(self.accounts)

    async def get_json(self, path):
        self.paths.append(path)
        value = self.overviews[path]
        if isinstance(value, Exception):
            raise value
        return value


def overview(value):
    return {"compliance": {"isCompliant": value}}


class CyberArkComplianceScriptTests(unittest.TestCase):
    def test_publish_stores_only_aggregate(self):
        connection = MagicMock()
        with patch.dict("os.environ", {"DATABASE_URL": "postgresql://test"}), patch.object(
            compliance_script.psycopg, "connect", return_value=connection,
        ):
            compliance_script.publish({"total_accounts": 3, "compliant_accounts": 2,
                                       "non_compliant_accounts": 1, "compliance_percent": 66.67})
        query, params = connection.__enter__.return_value.cursor.return_value.__enter__.return_value.execute.call_args.args
        self.assertIn("ON CONFLICT", query)
        self.assertEqual(params, (3, 2))

    def test_http_error_reports_only_status_without_response_body(self):
        from app.cyberark.pam.cyberark_errors import CyberArkError

        client = FakeClient(
            [{"id": "12_1"}],
            {"/API/ExtendedAccounts/12_1/overview": CyberArkError("CyberArk respondió HTTP 403: sensitive payload")},
        )
        with self.assertRaisesRegex(compliance_script.ComplianceError, r"primer overview \(HTTP 403\)") as caught:
            asyncio.run(compliance_script.calculate(client))
        self.assertNotIn("sensitive payload", str(caught.exception))

    def test_uses_all_accounts_and_overview_boolean(self):
        client = FakeClient(
            [{"id": "12_1"}, {"id": "12_2"}, {"id": "12_3"}],
            {
                "/API/ExtendedAccounts/12_1/overview": overview(True),
                "/API/ExtendedAccounts/12_2/overview": overview(False),
                "/API/ExtendedAccounts/12_3/overview": overview(True),
            },
        )
        self.assertEqual(asyncio.run(compliance_script.calculate(client)), {
            "total_accounts": 3,
            "compliant_accounts": 2,
            "non_compliant_accounts": 1,
            "compliance_percent": 66.67,
        })
        self.assertEqual(len(client.paths), 3)

    def test_missing_or_invalid_compliance_never_produces_a_percentage(self):
        for payload in ({}, overview("true")):
            with self.subTest(payload=payload):
                client = FakeClient([{"id": "12_1"}], {"/API/ExtendedAccounts/12_1/overview": payload})
                with self.assertRaises(compliance_script.ComplianceError):
                    asyncio.run(compliance_script.calculate(client))

    def test_failed_account_lookup_never_produces_a_percentage(self):
        client = FakeClient(
            [{"id": "12_1"}, {"id": "12_2"}],
            {
                "/API/ExtendedAccounts/12_1/overview": overview(True),
                "/API/ExtendedAccounts/12_2/overview": RuntimeError("failed"),
            },
        )
        with self.assertRaisesRegex(compliance_script.ComplianceError, "porcentaje omitido"):
            asyncio.run(compliance_script.calculate(client))


if __name__ == "__main__":
    unittest.main()
