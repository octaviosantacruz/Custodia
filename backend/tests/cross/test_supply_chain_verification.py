"""The security gate includes development tools and propagates audit failures."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/verify_supply_chain.sh"


class SupplyChainVerificationTests(unittest.TestCase):
    def run_gate(self, fail_npm=False):
        with tempfile.TemporaryDirectory() as directory:
            scratch = Path(directory)
            log = scratch / "calls.jsonl"
            for name in ("python-audit", "npm"):
                executable = scratch / name
                executable.write_text(
                    "#!/usr/bin/env python3\n"
                    "import json, os, sys\n"
                    "from pathlib import Path\n"
                    "with open(os.environ['AUDIT_CALLS'], 'a') as output:\n"
                    "    output.write(json.dumps([Path(sys.argv[0]).name, *sys.argv[1:]]) + '\\n')\n"
                    "sys.exit(1 if Path(sys.argv[0]).name == 'npm' and os.environ['FAIL_NPM'] == '1' else 0)\n"
                )
                executable.chmod(0o700)
            result = subprocess.run(
                ["bash", str(SCRIPT)], cwd=scratch, capture_output=True, text=True,
                env={
                    "PATH": f"{scratch}:/usr/bin:/bin",
                    "PYTHON_BIN": str(scratch / "python-audit"),
                    "AUDIT_CALLS": str(log), "FAIL_NPM": "1" if fail_npm else "0",
                },
                timeout=10,
            )
            return result, [json.loads(line) for line in log.read_text().splitlines()]

    def test_audits_locked_python_and_both_complete_npm_trees(self):
        result, calls = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [
            ["python-audit", "-m", "pip_audit", "-r", "backend/requirements.lock.txt"],
            ["npm", "audit", "--include=dev"],
            ["npm", "--prefix", "frontend", "audit", "--include=dev"],
        ])

    def test_a_vulnerable_npm_tree_fails_the_gate(self):
        result, calls = self.run_gate(fail_npm=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 2)
        self.assertNotIn("Auditoría de dependencias completa.", result.stdout)
