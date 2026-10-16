import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.cross.repositories.audit import list_activity


class ActivityEntityLabelTests(unittest.TestCase):
    def test_activity_query_resolves_catalog_entity_names(self):
        rows = [{"audit_id": 1, "total_count": 1, "entity_name": "Unidad Norte"}]
        with patch("app.cross.repositories.audit.fetch_all", new=AsyncMock(return_value=rows)) as fetch:
            result = asyncio.run(list_activity(object(), q="norte"))

        query = fetch.await_args.args[1]
        params = fetch.await_args.args[2]
        self.assertIn("cyberark_business_units", query)
        self.assertIn("cyberark_responsibles", query)
        self.assertIn("entity_name", query)
        self.assertEqual(params[:6], ("norte",) * 6)
        self.assertEqual(result["rows"][0]["entity_name"], "Unidad Norte")


if __name__ == "__main__":
    unittest.main()
