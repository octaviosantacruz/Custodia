import { formatNumber } from './format.ts';
import type { WorkspaceView } from './workspaces';
import type { PersonSource, PersonToolSummary } from './chains-api';

export type PersonToolTone = 'success' | 'warning' | 'neutral' | 'info';

export type PersonToolView = {
  tone: PersonToolTone;
  statusLabel: string;
  summary: string;
  why: string;
  openable: boolean;
};

export type PersonToolLink = { view: WorkspaceView; path?: string; query?: string };

export const PERSON_TOOL_ORDER: readonly PersonSource[] = ['pam', 'identity', 'sia', 'netskope'];

export const PERSON_TOOL_LABELS: Record<PersonSource, string> = {
  pam: 'CyberArk PAM',
  identity: 'Identity Administration',
  sia: 'SIA',
  netskope: 'Netskope',
};

const EMAIL_BASIS = 'Correo exacto 1 a 1 (misma dirección normalizada)';
const SIA_BASIS = 'Referencia por nombre, no confirmada';
const AMBIGUOUS_BASIS = 'La regla 1 a 1 exige un único candidato activo por lado';
const NO_RECORD = 'No hay registro de esta persona en la herramienta.';
const SIA_ONLY_BASIS = 'No tiene usuario propio en PAM: políticas de SIA lo nombran por su usuario de Identity o por uno de sus roles de Identity, siempre por nombre exacto (un rol repetido no cuenta). Es una referencia por nombre, no un identificador común.';
const ROLE_BASIS = 'No tiene usuario propio en PAM: su rol de Identity coincide por nombre exacto y único con un rol de PAM que da acceso a Safes. Es una referencia por nombre, no un identificador común.';

function pamCopy(tool: PersonToolSummary): string {
  const totals = tool.totals;
  if (!totals) return 'Usuario PAM resuelto.';
  return `${formatNumber(totals.roles)} roles · ${formatNumber(totals.safes)} Safes · ${formatNumber(totals.accounts)} cuentas`;
}

function identityCopy(tool: PersonToolSummary): string {
  const parts = [`${formatNumber(tool.role_count ?? 0)} roles`];
  parts.push(tool.federation ? `federación ${tool.federation.display_name}` : 'sin federación esperada');
  if (tool.user?.last_login_date) parts.push(`último acceso ${tool.user.last_login_date}`);
  return parts.join(' · ');
}

function netskopeCopy(tool: PersonToolSummary): string {
  const recent = tool.device_count ?? 0;
  const parts = [`${formatNumber(recent)} ${recent === 1 ? 'dispositivo reciente' : 'dispositivos recientes'}`];
  if (tool.stale_device_count) parts.push(`${formatNumber(tool.stale_device_count)} sin actividad en 7 días`);
  if (tool.company) parts.push(tool.company);
  const versions = tool.client_versions ?? [];
  if (versions.length) parts.push(`cliente ${versions.join(', ')}`);
  const systems = tool.operating_systems ?? [];
  if (systems.length) parts.push(systems.join(', '));
  return parts.join(' · ');
}

/** Maps a tool summary to its visual state; never invents data for a gap. */
export function personToolView(source: PersonSource, tool: PersonToolSummary | undefined, sia?: PersonToolSummary): PersonToolView {
  const siaPolicies = sia?.status === 'reference' ? (sia.sia_access?.policies ?? sia.policy_count ?? 0) : 0;
  // Roles that reach no Safe give way to SIA when SIA is the actual access.
  if (source === 'pam' && tool?.status === 'unmatched' && tool.role_access && tool.role_access.matched_roles > 0
    && (tool.role_access.safes > 0 || siaPolicies === 0)) {
    const safes = tool.role_access.safes;
    return {
      tone: safes > 0 ? 'info' : 'neutral',
      statusLabel: 'Acceso por rol · nombre exacto',
      summary: `${formatNumber(tool.role_access.matched_roles)} ${tool.role_access.matched_roles === 1 ? 'rol vinculado' : 'roles vinculados'} · ${formatNumber(safes)} ${safes === 1 ? 'Safe' : 'Safes'}`,
      why: ROLE_BASIS,
      openable: false,
    };
  }
  if (source === 'pam' && tool?.status === 'unmatched' && siaPolicies > 0) {
    return {
      tone: 'info',
      statusLabel: 'Acceso por SIA · nombre exacto',
      summary: `${formatNumber(siaPolicies)} ${siaPolicies === 1 ? 'política de SIA' : 'políticas de SIA'}`,
      why: SIA_ONLY_BASIS,
      openable: false,
    };
  }
  if (!tool || tool.status === 'unmatched') {
    return { tone: 'neutral', statusLabel: 'Sin registro', summary: NO_RECORD, why: '', openable: false };
  }
  if (tool.status === 'ambiguous') {
    return {
      tone: 'warning',
      statusLabel: 'Vínculo ambiguo',
      summary: 'Varios registros activos comparten el correo exacto; no se dibuja ningún vínculo.',
      why: AMBIGUOUS_BASIS,
      openable: false,
    };
  }
  if (tool.status === 'reference') {
    return {
      tone: 'info',
      statusLabel: 'Referencia por nombre',
      summary: `${formatNumber(tool.policy_count ?? 0)} políticas de SIA nombran a la persona por usuario o por rol de Identity.`,
      why: SIA_BASIS,
      openable: false,
    };
  }
  const suspended = source === 'pam' && tool.user?.suspended;
  return {
    tone: 'success',
    statusLabel: suspended ? 'Vinculado · suspendido' : 'Vinculado por correo',
    summary: source === 'pam' ? pamCopy(tool) : source === 'identity' ? identityCopy(tool) : netskopeCopy(tool),
    why: EMAIL_BASIS,
    // Identity and PAM are one node in Relaciones: the PAM tool opens it.
    openable: source !== 'identity',
  };
}

/** Deep link to the tool's own chain, only for a matched person. */
export function personToolLink(source: PersonSource, tool: PersonToolSummary | undefined): PersonToolLink | null {
  if (!tool || tool.status !== 'matched' || !tool.user) return null;
  if (source === 'pam') {
    return { view: 'graph', path: `/pam/graph?type=user&id=${tool.user.object_id}&dir=forward` };
  }
  if (source === 'netskope') {
    return { view: 'netskopeInventory', path: `/netskope/inventory?observed_user_id=${tool.user.object_id}&freshness=all` };
  }
  return null;
}
