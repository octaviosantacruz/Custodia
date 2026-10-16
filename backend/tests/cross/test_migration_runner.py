import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("migration_runner", ROOT / "scripts/migrate.py")
MIGRATION_RUNNER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MIGRATION_RUNNER)


class MigrationRunnerTests(unittest.TestCase):
    def test_generated_baseline_declares_every_numbered_migration(self):
        baseline = (ROOT / "migrations/baseline.sql").read_text(encoding="utf-8")
        embedded = MIGRATION_RUNNER.baseline_versions(baseline)
        numbered = [path.name.split("_", 1)[0] for path in sorted((ROOT / "migrations").glob("[0-9][0-9][0-9]_*.sql"))]

        self.assertEqual(embedded, numbered)


if __name__ == "__main__":
    unittest.main()
