import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const codeExtensions = new Set(['.ts', '.tsx']);
const importPattern = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g;

type Owner =
  | { kind: 'cross' }
  | { kind: 'cyberark'; tool: string }
  | { kind: 'netskope'; tool: string }
  | { kind: 'root' };

type SanctionedImport = { from: string; to: string; reason: string };

const sanctionedCyberArkImports: SanctionedImport[] = [
  {
    from: 'cyberark/pam/components/pam-platforms-workspace.tsx',
    to: 'cyberark/sia/lib/sia-resources-api.ts',
    reason: 'The approved PAM connector workspace composes the SIA connector catalog.',
  },
  {
    from: 'cyberark/pam/components/pam-platforms-workspace.tsx',
    to: 'cyberark/sia/types/sia.ts',
    reason: 'The approved PAM connector workspace types the separately owned SIA rows.',
  },
  {
    from: 'cyberark/pam/components/catalog-admin.tsx',
    to: 'cyberark/identity_administration/lib/identity-admin-api.ts',
    reason: 'The PAM catalog administration view includes the approved Identity user selector.',
  },
  {
    from: 'cyberark/pam/components/catalog-admin.tsx',
    to: 'cyberark/identity_administration/types/identity.ts',
    reason: 'The approved PAM catalog administration view types the Identity user selector rows.',
  },
  {
    from: 'cyberark/pam/components/posture-workspace.tsx',
    to: 'cyberark/risk_management/components/cyberark-risk-panel.tsx',
    reason: 'PAM posture composes the separately owned CyberArk Risk Management panel.',
  },
  {
    from: 'cyberark/pam/components/posture-workspace.tsx',
    to: 'cyberark/risk_management/components/cyberark-risk-overview.tsx',
    reason: 'PAM posture composes the separately owned Risk Management summary (Resumen and totals strip).',
  },
  {
    from: 'cyberark/pam/components/posture-workspace.tsx',
    to: 'cyberark/risk_management/components/cyberark-risk-finding-groups.tsx',
    reason: 'PAM posture composes the Risk Management findings grouped by risk type inside its single findings table.',
  },
  {
    from: 'cyberark/pam/components/posture-workspace.tsx',
    to: 'cyberark/risk_management/lib/cyberark-risk-labels.ts',
    reason: 'PAM posture uses the Risk Management labels for its composed panel.',
  },
  {
    from: 'cyberark/pam/components/posture-workspace.tsx',
    to: 'cyberark/risk_management/hooks/use-cyberark-risk.ts',
    reason: 'PAM posture uses the approved Risk Management query hook.',
  },
  {
    from: 'cyberark/pam/components/posture-workspace.tsx',
    to: 'cyberark/risk_management/lib/cyberark-risk-api.ts',
    reason: 'PAM posture uses the Risk Management finding contract and page size.',
  },
  {
    from: 'cyberark/pam/types/pam.ts',
    to: 'cyberark/sia/types/sia.ts',
    reason: 'PAM role-chain response retains its approved SIA policy reference type.',
  },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return codeExtensions.has(extname(path)) ? [path] : [];
  });
}

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.css'].map((suffix) => `${base}${suffix}`), ...['.ts', '.tsx', '.js', '.jsx'].map((suffix) => join(base, `index${suffix}`))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function srcPath(path: string): string {
  return relative(sourceRoot, path).split(sep).join('/');
}

function owner(path: string): Owner {
  const relativePath = srcPath(path);
  if (relativePath.startsWith('cross/')) return { kind: 'cross' };
  if (relativePath.startsWith('cyberark/')) return { kind: 'cyberark', tool: relativePath.split('/')[1] };
  if (relativePath.startsWith('netskope/')) return { kind: 'netskope', tool: relativePath.split('/')[1] };
  return { kind: 'root' };
}

function isSanctioned(from: string, to: string): boolean {
  return sanctionedCyberArkImports.some((entry) => entry.from === from && entry.to === to);
}

test('frontend imports stay within their platform and tool ownership boundaries', () => {
  const violations: string[] = [];
  for (const fromFile of sourceFiles(sourceRoot)) {
    const source = srcPath(fromFile);
    const sourceOwner = owner(fromFile);
    const contents = readFileSync(fromFile, 'utf8');
    importPattern.lastIndex = 0;
    for (const match of contents.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier.startsWith('.')) continue;
      const targetFile = resolveRelativeImport(fromFile, specifier);
      if (!targetFile) {
        violations.push(`${source} -> ${specifier} (unresolved relative import)`);
        continue;
      }
      if (!codeExtensions.has(extname(targetFile))) continue;

      const target = srcPath(targetFile);
      const targetOwner = owner(targetFile);
      if (sourceOwner.kind === 'cross') {
        if (targetOwner.kind === 'cyberark' || targetOwner.kind === 'netskope') {
          violations.push(`${source} -> ${target} (cross may not import tool code)`);
        } else if (targetOwner.kind === 'root' && !['source-contract.ts', 'sources.ts'].includes(target)) {
          violations.push(`${source} -> ${target} (cross may import only the root source contracts/registry)`);
        }
      }

      if ((sourceOwner.kind === 'cyberark' && targetOwner.kind === 'netskope')
        || (sourceOwner.kind === 'netskope' && targetOwner.kind === 'cyberark')) {
        violations.push(`${source} -> ${target} (CyberArk and Netskope tools are isolated)`);
      }

      if (sourceOwner.kind === 'cyberark' && targetOwner.kind === 'cyberark'
        && sourceOwner.tool !== targetOwner.tool
        && sourceOwner.tool !== 'shared' && targetOwner.tool !== 'shared'
        && !isSanctioned(source, target)) {
        violations.push(`${source} -> ${target} (unsanctioned CyberArk tool dependency)`);
      }
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});
