import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.cross.services.secret_values import secret_from_environment


class SecretValuesTests(unittest.TestCase):
    def test_file_secret_takes_precedence_over_inline_value(self):
        with tempfile.TemporaryDirectory() as directory:
            secret_path = Path(directory) / "secret"
            secret_path.write_text("from-file\n", encoding="utf-8")
            with patch.dict(os.environ, {"TEST_SECRET": "inline", "TEST_SECRET_FILE": str(secret_path)}, clear=False):
                self.assertEqual(secret_from_environment("TEST_SECRET", "TEST_SECRET_FILE"), "from-file")

    def test_inline_secret_remains_a_compatibility_fallback(self):
        with patch.dict(os.environ, {"TEST_SECRET": "inline"}, clear=True):
            self.assertEqual(secret_from_environment("TEST_SECRET", "TEST_SECRET_FILE"), "inline")

    def test_missing_file_error_is_sanitized(self):
        with patch.dict(os.environ, {"TEST_SECRET_FILE": "/path/that/does/not/exist"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "No se pudo leer el secreto"):
                secret_from_environment("TEST_SECRET", "TEST_SECRET_FILE")


if __name__ == "__main__":
    unittest.main()
