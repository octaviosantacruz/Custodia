from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "scripts" / "run_with_database_secret.py"
SPEC = importlib.util.spec_from_file_location("run_with_database_secret", SCRIPT_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class ExecCalled(RuntimeError):
    pass


class RunWithDatabaseSecretTests(unittest.TestCase):
    def test_recovered_secret_is_not_overwritten_by_stale_password_file_in_child(self) -> None:
        captured_environment: dict[str, str] = {}

        def execvpe(_program: str, _command: list[str], environment: dict[str, str]) -> None:
            captured_environment.update(environment)
            raise ExecCalled

        resolution = SimpleNamespace(
            database_url="postgresql://app:current@db.internal/dshub",
            recovered_from_aws=True,
        )
        environment = {
            "DATABASE_URL": "postgresql://app:stale@db.internal/dshub",
            "DATABASE_PASSWORD_FILE": "/run/secrets/stale-password",
            "DATABASE_SECRET_ID": "rds!db-example",
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(RUNNER, "parse_args", return_value=SimpleNamespace(command=["child"])),
            patch.object(RUNNER, "load_dotenv"),
            patch.object(RUNNER, "database_url_from_password_file", return_value=environment["DATABASE_URL"]),
            patch.object(RUNNER, "resolve_database_url", return_value=resolution),
            patch.object(RUNNER.os, "execvpe", side_effect=execvpe),
            self.assertRaises(ExecCalled),
        ):
            RUNNER.main()

        self.assertEqual(captured_environment["DATABASE_URL"], resolution.database_url)
        self.assertEqual(captured_environment["DATABASE_PASSWORD_FILE"], "")

    def test_recovery_notice_explains_it_is_a_success_and_points_to_the_refresh_script(self) -> None:
        with_file = RUNNER.recovered_notice(".secrets/database_password")
        self.assertIn("sólo en memoria", with_file)
        self.assertIn(".secrets/database_password sigue desactualizado", with_file)
        self.assertIn("scripts/refresh_database_password.sh", with_file)
        self.assertNotIn("refresh_database_password", RUNNER.recovered_notice(""))


if __name__ == "__main__":
    unittest.main()
