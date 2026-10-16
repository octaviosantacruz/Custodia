"""AUTH-AGENT-001: scripts/agent_access.py hands the credential only to agent-browser
through stdin: never as an argument, never on stdout or in an error message."""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import io
import subprocess
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("agent_access", ROOT / "scripts" / "agent_access.py")
assert SPEC and SPEC.loader
AGENT_ACCESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AGENT_ACCESS)

SECRET = "generated-secret-value-never-shown"


def completed(code=0, output=""):
    return subprocess.CompletedProcess([], code, stdout=output, stderr=output)


class AgentAccessScriptTests(unittest.TestCase):
    def setUp(self):
        # A test must never reach the real agent-browser: it would overwrite the operator's saved profile.
        guard = patch.object(AGENT_ACCESS.subprocess, "run", side_effect=AssertionError("agent-browser real invocado desde un test"))
        guard.start()
        self.addCleanup(guard.stop)

    def run_main(self, argv, *, opened=SECRET, closed=True, run=None):
        pool = MagicMock(open=AsyncMock(), close=AsyncMock())
        run = run or MagicMock(return_value=completed())
        stdout = io.StringIO()
        with patch.dict("os.environ", {"DATABASE_URL": "postgresql://example.invalid/db"}), \
             patch.object(AGENT_ACCESS, "create_pool", return_value=pool), \
             patch.object(AGENT_ACCESS, "open_automation_access", new=AsyncMock(return_value=opened)) as open_access, \
             patch.object(AGENT_ACCESS, "close_automation_access", new=AsyncMock(return_value=closed)) as close_access, \
             patch.object(AGENT_ACCESS.subprocess, "run", new=run), \
             patch.object(AGENT_ACCESS.sys, "argv", ["agent_access", *argv]), \
             contextlib.redirect_stdout(stdout):
            AGENT_ACCESS.main()
        pool.close.assert_awaited_once()
        return stdout.getvalue(), run, open_access, close_access

    def test_open_sends_the_credential_to_the_local_login_profile_only_through_stdin(self):
        output, run, open_access, close_access = self.run_main(["open", "--email", "Admin@Example.test"])
        self.assertEqual(open_access.await_args.args[1], "admin@example.test")
        self.assertTrue(open_access.await_args.args[2].startswith("system:agent-access:"))
        close_access.assert_not_awaited()
        command, kwargs = run.call_args.args[0], run.call_args.kwargs
        self.assertEqual(command[:4], ["agent-browser", "auth", "save", "dshub"])
        self.assertIn("http://localhost:5173/login/local", command)
        self.assertIn("--password-stdin", command)
        self.assertNotIn(SECRET, " ".join(command))
        self.assertEqual(kwargs["input"], SECRET)
        self.assertNotIn(SECRET, output)
        self.assertIn("activa", output)

    def test_close_deactivates_and_deletes_the_profile(self):
        output, run, open_access, close_access = self.run_main(["close", "--email", "admin@example.test"])
        close_access.assert_awaited_once()
        open_access.assert_not_awaited()
        self.assertEqual(run.call_args.args[0], ["agent-browser", "auth", "delete", "dshub"])
        self.assertIn("desactivada", output)

    def test_a_failed_profile_save_is_reported_without_the_secret(self):
        run = MagicMock(return_value=completed(1, SECRET))
        with self.assertRaises(SystemExit) as raised:
            self.run_main(["open", "--email", "admin@example.test"], run=run)
        self.assertNotIn(SECRET, str(raised.exception))
        self.assertIn("Volvé a ejecutar open", str(raised.exception))

    def test_a_missing_account_fails_clearly(self):
        for action, kwargs in (("open", {"opened": None}), ("close", {"closed": False})):
            with self.subTest(action=action), self.assertRaises(SystemExit) as raised:
                self.run_main([action, "--email", "admin@example.test"], **kwargs)
            self.assertIn("No existe la cuenta local", str(raised.exception))

    def test_a_close_that_would_leave_no_administrator_is_explained(self):
        with patch.object(AGENT_ACCESS, "close_automation_access", new=AsyncMock(side_effect=ValueError("sin administrador"))):
            with self.assertRaisesRegex(AGENT_ACCESS.AgentAccessError, "No se desactivó.*sin administrador"):
                asyncio.run(AGENT_ACCESS.change_access(object(), "close", "admin@example.test", "system:agent-access:test"))


if __name__ == "__main__":
    unittest.main()
