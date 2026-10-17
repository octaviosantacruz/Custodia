"""Contract tests for the PostgreSQL integration-test runner."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]
RUNNER = ROOT / "scripts" / "verify_postgres_integration.sh"


class VerifyPostgresIntegrationScriptTests(unittest.TestCase):
    def test_explicit_skip_exits_cleanly_without_postgres_binaries(self):
        environment = os.environ | {
            "CUSTODIA_SKIP_PG": "1",
            "POSTGRES_BIN_DIR": str(ROOT / "missing-postgres-bin-dir"),
        }

        result = subprocess.run(
            ["bash", str(RUNNER), "python3"],
            cwd=ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CUSTODIA_SKIP_PG=1", result.stdout)
