import inspect
import unittest

from app.cyberark.pam.api.routes.catalogs import create_business_unit_route
from app.cross.api.routes.connection_inventory import import_connection_inventory
from app.cyberark.pam.api.routes.findings import finding_update
from app.cyberark.pam.api.routes.ingestion import ingestion_preview, start_ingestion
from app.cyberark.access.api.routes.ingestion import start_access_ingestion
from app.cross.api.routes.ingestion import start_all_ingestion
from app.cyberark.identity_administration.api.routes.ingestion import start_identity_admin_ingestion
from app.cyberark.sia.api.routes.ingestion import start_sia_ingestion
from app.cyberark.pam.api.routes.safe_write import bulk_update_safe_assignment_route, update_safe_assignment_route


def required_permission(endpoint) -> str:
    dependency = inspect.signature(endpoint).parameters["actor_id"].default.dependency
    values = [cell.cell_contents for cell in dependency.__closure__ or ()]
    return next(value for value in values if isinstance(value, str))


class GranularActionPermissionTests(unittest.TestCase):
    def test_inventory_mutations_use_narrow_capabilities(self):
        self.assertEqual(required_permission(update_safe_assignment_route), "safes:manage")
        self.assertEqual(required_permission(bulk_update_safe_assignment_route), "safes:manage")
        self.assertEqual(required_permission(import_connection_inventory), "coverage:manage")
        self.assertEqual(required_permission(finding_update), "findings:manage")

    def test_ingestion_sources_share_the_explicit_run_capability(self):
        self.assertEqual(required_permission(ingestion_preview), "ingestion:preview")
        self.assertEqual(required_permission(start_ingestion), "ingestion:run")
        self.assertEqual(required_permission(start_all_ingestion), "ingestion:run")
        self.assertEqual(required_permission(start_sia_ingestion), "ingestion:run")
        self.assertEqual(required_permission(start_identity_admin_ingestion), "ingestion:run")
        self.assertEqual(required_permission(start_access_ingestion), "ingestion:run")

    def test_catalog_mutations_use_the_explicit_manage_capability(self):
        self.assertEqual(required_permission(create_business_unit_route), "catalogs:manage")


if __name__ == "__main__":
    unittest.main()
