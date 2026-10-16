import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cyberark.pam.api.routes.catalog_models import CatalogsResponse
from app.cyberark.pam.repositories.catalog_queries import get_catalogs


class CatalogQueryTests(unittest.TestCase):
    def test_account_type_query_uses_manual_safe_classification(self):
        fetch = AsyncMock(side_effect=[
            [],
            [],
            [{'key': 'CYBERARK MANAGED', 'count': 2, 'safes': 2}],
        ])

        with patch('app.cyberark.pam.repositories.catalog_queries.fetch_all', new=fetch):
            result = asyncio.run(get_catalogs(object()))

        account_type_query = fetch.await_args_list[2].args[1]
        self.assertIn('account_type_classification', account_type_query)
        self.assertIn('Sin clasificar', account_type_query)
        self.assertNotIn('inventory_account_types', account_type_query)
        CatalogsResponse.model_validate(result)
