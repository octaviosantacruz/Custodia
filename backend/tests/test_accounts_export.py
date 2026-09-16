import asyncio
import csv
import io
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.api.routes.safe_read import export_accounts_csv

from app.api.routes.safe_read import _accounts_csv
from app.repositories.account_queries import export_accounts


class AccountExportTests(unittest.TestCase):
    def test_csv_contains_operational_fields_only(self):
        content = _accounts_csv([{
            'safe_name': 'AS400',
            'safe_url_id': 'AS400',
            'account_name': 'Operating System-AS400',
            'user_name': 'ca_as400',
            'platform_name': 'Unix',
            'platform_id': 'unix-id',
            'address': '10.0.0.1',
            'lifecycle_status': 'active',
            'last_seen_at': '2026-08-16T00:00:00Z',
        }])
        rows = list(csv.reader(io.StringIO(content)))
        self.assertEqual(rows[0], [
            'Safe', 'Safe URL ID', 'Cuenta', 'Usuario', 'Plataforma',
            'Dirección', 'Estado', 'Última sincronización',
        ])
        self.assertEqual(rows[1][2], 'Operating System-AS400')
        self.assertNotIn('password', content.lower())
        self.assertNotIn('secret', content.lower())
        self.assertNotIn('attributes', content.lower())

    def test_csv_neutralizes_spreadsheet_formulas(self):
        content = _accounts_csv([{
            'safe_name': '=HYPERLINK("https://evil.invalid")',
            'safe_url_id': 'safe-id',
            'account_name': '+CMD|/C calc!A0',
            'user_name': '@external',
            'platform_name': 'Unix',
            'platform_id': None,
            'address': '-10.0.0.1',
            'lifecycle_status': 'active',
            'last_seen_at': '2026-08-16T00:00:00Z',
        }])
        row = list(csv.reader(io.StringIO(content)))[1]
        self.assertTrue(row[0].startswith("'=HYPERLINK"))
        self.assertTrue(row[2].startswith("'+CMD"))
        self.assertTrue(row[3].startswith("'@external"))
        self.assertTrue(row[5].startswith("'-10.0.0.1"))

    def test_export_query_is_active_only_and_parameterized(self):
        with patch('app.repositories.account_queries.fetch_all', new=AsyncMock(return_value=[])) as fetch:
            result = asyncio.run(export_accounts(object(), 'AS400'))

        self.assertEqual(result, [])
        _, query, params = fetch.await_args.args
        self.assertIn("a.lifecycle_status = 'active'", query)
        self.assertNotIn('AS400', query)
        self.assertEqual(params, ('AS400',) * 6)

    def test_export_route_passes_account_search_to_repository(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=object())))
        with patch('app.api.routes.safe_read.export_accounts', new=AsyncMock(return_value=[])) as export, \
             patch('app.api.routes.safe_read.record_audit', new=AsyncMock()):
            response = asyncio.run(export_accounts_csv(request, '  ca_as400  ', 'admin-id'))

        export.assert_awaited_once_with(request.app.state.db, 'ca_as400', '')
        self.assertEqual(response.media_type, 'text/csv; charset=utf-8')
        self.assertIn('dshub-accounts.csv', response.headers['content-disposition'])


if __name__ == '__main__':
    unittest.main()
