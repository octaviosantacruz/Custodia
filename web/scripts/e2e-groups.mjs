import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/* E2E specs grouped by the platform they exercise, so a change scoped to one
   platform runs only its own suite. Every spec belongs to exactly one group
   (enforced by tests/cross/e2e-groups.unit.test.ts). `cross` holds the shared shell,
   global widgets and the Personas views, which join Identity and Netskope;
   run it whenever shared code or both platforms change. */
export const E2E_GROUPS = {
  cyberark: [
    'cyberark/connector_manager/connector-manager.spec.ts',
    'cyberark/identity_administration/identity.spec.ts', 'cyberark/pam/coverage-import.spec.ts', 'cyberark/pam/pam-cleanup.spec.ts', 'cyberark/pam/pam.spec.ts',
    'cyberark/risk_management/posture.spec.ts', 'cyberark/pam/safes.spec.ts', 'cyberark/sia/sia.spec.ts',
  ],
  netskope: [
    'netskope/sse/netskope-aa.spec.ts', 'netskope/sse/netskope-admins.spec.ts', 'netskope/sse/netskope-dlp.spec.ts', 'netskope/sse/netskope-experience.spec.ts', 'netskope/sse/netskope-fleet.spec.ts', 'netskope/sse/netskope-posture.spec.ts', 'netskope/sse/netskope-uci.spec.ts', 'netskope/sse/netskope.spec.ts',
  ],
  cross: [
    'cross/activity.spec.ts', 'cross/api-request-count.spec.ts', 'cross/auth.spec.ts', 'cross/compact-select.spec.ts', 'cross/dashboard-settings.spec.ts', 'cross/dashboard.spec.ts',
    'cross/help.spec.ts', 'cross/identity-links.spec.ts', 'cross/metric-reading.spec.ts', 'cross/motion.spec.ts',
    'cross/person-client-coverage.spec.ts', 'cross/person-connections-ux.spec.ts', 'cross/person.spec.ts',
    'cross/sync-runs.spec.ts', 'cross/sync-status.spec.ts', 'cross/toast.spec.ts', 'cross/ux-aud.spec.ts',
  ],
};

/* Anchored so `pam.spec.ts` never also selects `pam-cleanup.spec.ts`. */
export function groupFilters(name) {
  const specs = E2E_GROUPS[name];
  if (!specs) throw new Error(`Grupo E2E desconocido: ${name}. Disponibles: ${Object.keys(E2E_GROUPS).join(', ')}`);
  return specs.map((spec) => `tests/e2e/${spec.replace(/\./g, '\\.')}$`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name, ...extra] = process.argv.slice(2);
  let filters;
  try {
    filters = groupFilters(name ?? '');
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const result = spawnSync('npx', ['playwright', 'test', ...extra, ...filters], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
