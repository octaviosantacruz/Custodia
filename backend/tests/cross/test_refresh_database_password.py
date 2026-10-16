from __future__ import annotations

import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("refresh_database_password", ROOT / "scripts" / "refresh_database_password.py")
assert SPEC and SPEC.loader
REFRESH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFRESH)

BASE_URL = "host=db.internal port=5432 user=app dbname=dshub"
FRESH = "fresh-password-value"


def fetch(_secret_id, _region):
    return json.dumps({"password": FRESH})


class RefreshDatabasePasswordTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file = Path(self.directory.name) / "database_password"

    def accepting(self, *accepted):
        def probe(url):
            if not any(f"password={value}" in url for value in accepted):
                raise psycopg.OperationalError("password authentication failed")
        return probe

    def test_an_already_valid_file_is_left_untouched_and_aws_is_not_called(self):
        self.file.write_text("old\n")
        calls = []
        outcome = REFRESH.refresh(self.file, BASE_URL, "id", None, probe=self.accepting("old"), fetch_secret=lambda *a: calls.append(a))
        self.assertEqual((outcome, calls, self.file.read_text()), ("current", [], "old\n"))

    def test_a_stale_file_is_replaced_with_the_validated_aws_password_as_0600(self):
        self.file.write_text("stale\n")
        os.chmod(self.file, 0o644)
        outcome = REFRESH.refresh(self.file, BASE_URL, "id", None, probe=self.accepting(FRESH), fetch_secret=fetch)
        self.assertEqual(outcome, "updated")
        self.assertEqual(self.file.read_text(), FRESH + "\n")
        self.assertEqual(stat.S_IMODE(self.file.stat().st_mode), 0o600)
        self.assertEqual([p.name for p in Path(self.directory.name).iterdir()], ["database_password"])

    def test_a_missing_file_is_created(self):
        outcome = REFRESH.refresh(self.file, BASE_URL, "id", None, probe=self.accepting(FRESH), fetch_secret=fetch)
        self.assertEqual((outcome, self.file.read_text()), ("updated", FRESH + "\n"))

    def test_an_aws_password_the_database_rejects_never_replaces_the_file(self):
        self.file.write_text("stale\n")
        with self.assertRaises(REFRESH.DatabaseCredentialError) as raised:
            REFRESH.refresh(self.file, BASE_URL, "id", None, probe=self.accepting(), fetch_secret=fetch)
        self.assertEqual(self.file.read_text(), "stale\n")
        self.assertNotIn(FRESH, str(raised.exception))

    def test_a_secret_without_a_password_is_refused(self):
        with self.assertRaises(REFRESH.DatabaseCredentialError):
            REFRESH.refresh(self.file, BASE_URL, "id", None, probe=self.accepting(FRESH), fetch_secret=lambda *a: json.dumps({"username": "app"}))
        self.assertFalse(self.file.exists())


if __name__ == "__main__":
    unittest.main()
