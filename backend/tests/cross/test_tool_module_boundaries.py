"""Architecture contract: platform inventories cannot import each other.

Source-system SQL guards protect query contents. This guard also rejects a
new dependency on another platform's client, synchronizer or UI at import time.
Cross-source composition belongs in cross, outside the two inventory trees.
"""
import ast
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / 'backend/app'
FRONTEND = ROOT / 'frontend/src'


class ToolModuleBoundaryTests(unittest.TestCase):
    def test_backend_platforms_do_not_import_each_other(self):
        violations = []
        for platform, other in (('cyberark', 'netskope'), ('netskope', 'cyberark')):
            for path in (BACKEND / platform).rglob('*.py'):
                for node in ast.walk(ast.parse(path.read_text())):
                    modules = []
                    if isinstance(node, ast.ImportFrom):
                        modules = [node.module or '']
                        if node.module == 'app':
                            modules.extend(f'app.{alias.name}' for alias in node.names)
                    elif isinstance(node, ast.Import):
                        modules = [alias.name for alias in node.names]
                    for module in modules:
                        if module == f'app.{other}' or module.startswith(f'app.{other}.'):
                            violations.append(f'{path.relative_to(ROOT)}:{node.lineno}: {module}')
        self.assertEqual(violations, [], '\n'.join(violations))

    def test_frontend_platforms_do_not_import_each_other(self):
        imports = re.compile(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']''')
        violations = []
        for platform, other in (('cyberark', 'netskope'), ('netskope', 'cyberark')):
            for path in (FRONTEND / platform).rglob('*'):
                if path.suffix not in ('.ts', '.tsx'):
                    continue
                for match in imports.finditer(path.read_text()):
                    specifier = match[1]
                    if not specifier.startswith('.'):
                        continue
                    target = (path.parent / specifier).resolve()
                    if target.is_relative_to(FRONTEND / other):
                        violations.append(f'{path.relative_to(ROOT)}: {specifier}')
        self.assertEqual(violations, [], '\n'.join(violations))

    def test_global_layer_directories_do_not_collect_tool_code_again(self):
        violations = []
        for base, layers, suffixes in (
            (BACKEND, ('api', 'repositories', 'services', 'integrations'), {'.py'}),
            (FRONTEND, ('components', 'hooks', 'lib', 'types', 'domains', 'context', 'content'), {'.ts', '.tsx', '.css'}),
        ):
            for layer in layers:
                violations.extend(
                    str(path.relative_to(ROOT)) for path in (base / layer).rglob('*')
                    if path.is_file() and path.suffix in suffixes
                )
        self.assertEqual(violations, [], '\n'.join(violations))
