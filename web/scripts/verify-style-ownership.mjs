import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const frontendRoot = resolve(import.meta.dirname, '..');
/* FE-CSS-001: styles.css keeps only what several domains share. Lower this cap
   whenever lines leave the file; raising it is a conscious decision, not drift.
   New shared styles belong to the workspace-owned stylesheets below. */
const maxSharedStyleLines = 769;
const ownedStyles = [
  ['cyberark/pam/components/dashboard-data-item.tsx', 'cyberark/pam/components/dashboard-data-item.css'],
  ['cross/components/role-members.tsx', 'cross/components/role-members.css'],
  ['cross/components/access-capabilities.tsx', 'cross/components/access-capabilities.css'],
  ['cross/components/auth-view.tsx', 'cross/components/auth-view.css'],
  ['cross/components/home-workspace.tsx', 'cross/components/home-workspace.css'],
  ['cross/components/connection-inventory-workspace.tsx', 'cross/components/connection-inventory-workspace.css'],
  ['cross/components/sync-schedule-view.tsx', 'cross/components/sync-schedule-view.css'],
  ['cross/components/stale-data-banner.tsx', 'cross/components/stale-data-banner.css'],
  ['cyberark/identity_administration/components/identity-drawer.tsx', 'cyberark/identity_administration/components/identity-drawer.css'],
  ['netskope/sse/components/netskope-operations.tsx', 'netskope/sse/components/netskope-operations.css'],
  ['netskope/sse/components/netskope-workspace.tsx', 'netskope/sse/components/netskope-workspace.css'],
  ['netskope/sse/components/netskope-dlp-alerts.tsx', 'netskope/sse/components/netskope-dlp-alerts.css'],
  ['cyberark/pam/components/pam-roles-workspace.tsx', 'cyberark/pam/components/pam-roles-workspace.css'],
  ['cyberark/pam/components/pam-platforms-workspace.tsx', 'cyberark/pam/components/pam-technical-catalog.css'],
  ['cyberark/pam/components/safe-detail-drawer.tsx', 'cyberark/pam/components/safe-detail-drawer.css'],
  ['cyberark/pam/components/safe-table.tsx', 'cyberark/pam/components/safe-table.css'],
  ['cyberark/sia/components/sia-workspace.tsx', 'cyberark/sia/components/sia-workspace.css'],
  ['cross/components/user-admin.tsx', 'cross/components/user-admin.css'],
  ['cross/components/role-admin.tsx', 'cross/components/role-admin.css'],
  ['cross/components/role-access-editor.tsx', 'cross/components/role-access-editor.css'],
  ['cross/components/role-group-links.tsx', 'cross/components/role-group-links.css'],
  ['cross/components/access-tool-mark.tsx', 'cross/components/access-tool-mark.css'],
  ['cross/components/compact-select.tsx', 'cross/components/compact-select.css'],
  ['cross/components/sync-toast.tsx', 'cross/components/sync-toast.css'],
  ['cross/components/workspace-switcher.tsx', 'cross/components/workspace-switcher.css'],
  ['cross/components/app-header.tsx', 'cross/components/app-header.css'],
  ['cross/components/semantic.tsx', 'cross/components/semantic.css'],
  ['cross/components/dashboard-widget-picker.tsx', 'cross/components/dashboard-widget.css'],
  ['cyberark/pam/components/safe-table.tsx', 'cyberark/pam/components/safe-table.css'],
];

function content(relativePath) {
  const path = resolve(frontendRoot, 'src', relativePath);
  if (!existsSync(path)) throw new Error(`Falta ${relativePath}.`);
  return readFileSync(path, 'utf8');
}

const sharedStyleLines = content('styles.css').split('\n').length - 1;
if (sharedStyleLines > maxSharedStyleLines) {
  throw new Error(`styles.css creció a ${sharedStyleLines} líneas (máximo legado: ${maxSharedStyleLines}). Colocá los estilos nuevos con el workspace dueño.`);
}

for (const [owner, stylesheet] of ownedStyles) {
  const ownerContent = content(owner);
  const importPath = `./${stylesheet.split('/').at(-1)}`;
  if (!ownerContent.includes(`import '${importPath}';`)) {
    throw new Error(`${owner} debe importar ${stylesheet}.`);
  }
  content(stylesheet);
}

console.log('Propiedad de estilos verificada.');
