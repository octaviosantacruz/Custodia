import { formatNumber } from './format.ts';
import type { PersonSource, PersonToolSummary } from './chains-api';
import { t } from '../i18n/index.ts';

/* UX-PERSON-002: the person map represents platforms, not CyberArk internal
   capabilities. The only branches are CyberArk PAM and Netskope; Identity
   Administration and SIA remain source-scoped details in the CyberArk panel.
   Coordinates are shared by the SVG edges and HTML nodes, and by Home. */

export const PERSON_STAGE = { width: 160, height: 120 } as const;
export const PERSON_CENTER = { x: 80, y: 60 } as const;

export type PersonNodeId = Extract<PersonSource, 'pam' | 'netskope'>;
export type PersonNodeDepth = 0;
export type PersonFactSide = 'left' | 'right';

export type StagePoint = { x: number; y: number };

export type PersonTopologyNode = {
  id: PersonNodeId;
  parent: PersonNodeId | null;
  depth: PersonNodeDepth;
  position: StagePoint;
  /* Facts stack on the branch's outer side, away from the person. */
  factSide: PersonFactSide;
};

/* Deterministic order, main branches first and each branch followed by its
   own tools: it drives the DOM order (and therefore the narrow-screen list). */
export const PERSON_TOPOLOGY_ORDER: readonly PersonNodeId[] = ['pam', 'netskope'];

export const PERSON_TOPOLOGY: Record<PersonNodeId, PersonTopologyNode> = {
  pam: { id: 'pam', parent: null, depth: 0, position: { x: 116, y: 60 }, factSide: 'right' },
  netskope: { id: 'netskope', parent: null, depth: 0, position: { x: 44, y: 60 }, factSide: 'left' },
};

export function topologyNode(id: PersonNodeId): PersonTopologyNode {
  return PERSON_TOPOLOGY[id];
}

/** Platform maps intentionally have no child nodes. */
export function topologyChildren(id: PersonNodeId): PersonNodeId[] {
  return PERSON_TOPOLOGY_ORDER.filter((nodeId) => PERSON_TOPOLOGY[nodeId].parent === id);
}

/** Percent offsets for an HTML node placed over the stage. */
export function stagePercent(point: StagePoint): { left: string; top: string } {
  return {
    left: `${round((point.x / PERSON_STAGE.width) * 100)}%`,
    top: `${round((point.y / PERSON_STAGE.height) * 100)}%`,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PersonEdge = { from: StagePoint; to: StagePoint };

/* Every edge leaves the person and belongs to its destination platform, so
   its style keeps that platform's real link provenance. */
export function personEdge(id: PersonNodeId): PersonEdge {
  const node = PERSON_TOPOLOGY[id];
  return {
    from: PERSON_CENTER,
    to: node.position,
  };
}

export function toolPosition(source: PersonNodeId): StagePoint {
  return PERSON_TOPOLOGY[source].position;
}

const FACT_OFFSET = 26;
const FACT_SPACING = 10;

/** Places the selected tool's facts on its branch's outer side. */
export function factPositions(source: PersonNodeId, count: number): StagePoint[] {
  const node = PERSON_TOPOLOGY[source];
  const x = round(node.position.x + (node.factSide === 'right' ? FACT_OFFSET : -FACT_OFFSET));
  return Array.from({ length: count }, (_, index) => ({
    x,
    y: round(node.position.y + (index - (count - 1) / 2) * FACT_SPACING),
  }));
}

export type PersonLinkStyle = 'linked' | 'reference' | 'ambiguous' | 'none';

export type PersonFact = { label: string; value: string };

/** How the spoke is drawn: never a line for a person the tool does not have.
    For CyberArk, `sia` is the person's SIA summary: SIA belongs to CyberArk. */
export function personLinkStyle(tool: PersonToolSummary | undefined, sia?: PersonToolSummary): PersonLinkStyle {
  if (!tool) return 'none';
  // Access through an Identity role or a SIA grantee, linked by exact name: a name reference, never a confirmed link.
  if (tool.status === 'unmatched' && (hasRoleAccess(tool) || siaPolicyCount(sia) > 0)) return 'reference';
  if (tool.status === 'matched') return 'linked';
  if (tool.status === 'reference') return 'reference';
  if (tool.status === 'ambiguous') return 'ambiguous';
  return 'none';
}

/** Sanctioned exception (2026-10-05): Safes reached through Identity roles linked by exact unique name. */
export function hasRoleAccess(tool: PersonToolSummary | undefined): boolean {
  return Boolean(tool?.role_access && tool.role_access.safes > 0);
}

/** SIA policies reaching the person (sanctioned exact-name rule, 2026-10-05). */
export function siaPolicyCount(sia: PersonToolSummary | undefined): number {
  if (!sia || sia.status !== 'reference') return 0;
  return sia.sia_access?.policies ?? sia.policy_count ?? 0;
}

/** How the SIA policies reach the person: directly by user name or through an Identity role. */
export function siaAccessDetail(sia: PersonToolSummary | undefined): string {
  const access = sia?.sia_access;
  if (!access || !access.policies) return '';
  const parts: string[] = [];
  if (access.user_policies) parts.push(t('{n} por usuario', { n: formatNumber(access.user_policies) }));
  if (access.role_policies) parts.push(t('{n} por rol de Identity', { n: formatNumber(access.role_policies) }));
  return parts.join(' · ');
}

/** The one number shown under a tool node. */
export function personToolHeadline(source: PersonSource, tool: PersonToolSummary | undefined): string {
  if (!tool || tool.status === 'unmatched') return t('Sin registro');
  if (tool.status === 'ambiguous') return t('Vínculo ambiguo');
  if (source === 'sia') return plural(tool.policy_count ?? 0, 'política', 'políticas');
  if (source === 'netskope') return plural(tool.device_count ?? 0, 'dispositivo', 'dispositivos');
  if (source === 'identity') return plural(tool.role_count ?? 0, 'rol', 'roles');
  if (tool.totals) return plural(tool.totals.safes, 'Safe', 'Safes');
  return t('Usuario resuelto');
}

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? t(one) : t(many)}`;
}

/** Second-orbit facts; only what the tool reported, nothing inferred. */
export function personToolFacts(source: PersonSource, tool: PersonToolSummary | undefined): PersonFact[] {
  if (source === 'pam' && tool?.status === 'unmatched' && tool.role_access && (tool.role_access.matched_roles || tool.role_access.ambiguous_roles)) {
    const facts: PersonFact[] = [
      { label: t('Roles vinculados'), value: formatNumber(tool.role_access.matched_roles) },
      { label: t('Safes por rol'), value: formatNumber(tool.role_access.safes) },
    ];
    if (tool.role_access.ambiguous_roles) facts.push({ label: t('Roles ambiguos'), value: formatNumber(tool.role_access.ambiguous_roles) });
    return facts;
  }
  if (!tool || tool.status === 'unmatched' || tool.status === 'ambiguous') return [];
  if (source === 'pam') {
    const totals = tool.totals;
    if (!totals) return [];
    return [
      { label: t('Roles'), value: formatNumber(totals.roles) },
      { label: t('Safes'), value: formatNumber(totals.safes) },
      { label: t('Plataformas'), value: formatNumber(totals.platforms) },
      { label: 'PSM', value: formatNumber(totals.psms) },
      { label: t('Cuentas'), value: formatNumber(totals.accounts) },
    ];
  }
  if (source === 'identity') {
    const facts: PersonFact[] = [
      { label: t('Roles'), value: formatNumber(tool.role_count ?? 0) },
      { label: t('Federación'), value: tool.federation?.display_name ?? 'Sin federación' },
    ];
    if (tool.user?.last_login_date) facts.push({ label: t('Último acceso'), value: tool.user.last_login_date });
    return facts;
  }
  if (source === 'sia') {
    return [{ label: t('Políticas'), value: formatNumber(tool.policy_count ?? 0) }];
  }
  const facts: PersonFact[] = [{ label: t('Recientes · 7 días'), value: formatNumber(tool.device_count ?? 0) }];
  if (tool.stale_device_count) facts.push({ label: t('Sin actividad'), value: formatNumber(tool.stale_device_count) });
  if (tool.company) facts.push({ label: t('Empresa'), value: tool.company });
  if (tool.client_versions?.length) facts.push({ label: t('Cliente'), value: tool.client_versions.join(', ') });
  if (tool.operating_systems?.length) facts.push({ label: t('Sistema'), value: tool.operating_systems.join(', ') });
  return facts;
}

/** Opens on the first linked platform so its facts are visible at once. */
export function defaultPersonTool(tools: ReadonlyArray<{ source: PersonNodeId; tool: PersonToolSummary | undefined }>): PersonNodeId | null {
  const linked = tools.find(({ tool }) => personLinkStyle(tool) === 'linked');
  return (linked ?? tools[0])?.source ?? null;
}

/* CONN-SPACE-001: each platform node answers one plain question, with the same
   kind of reading on both sides. CyberArk: does the person have privileged
   access? Netskope: does the person have the client? The count is a detail.
   A tool the actor cannot read is "unknown", never "no". */
export type PersonPlatformAnswerKind = 'yes' | 'no' | 'unknown' | 'ambiguous' | 'reference';
export type PersonPlatformAnswer = {
  answer: PersonPlatformAnswerKind;
  label: string;
  count: string | null;
  tone: 'success' | 'warning' | 'neutral' | 'info';
};

export const PERSON_PLATFORM_LABELS: Record<PersonNodeId, string> = { pam: t('CyberArk'), netskope: t('Netskope') };

/* CyberArk access has two paths: Safes (PAM) and SIA policies (on-demand
   access to servers). Both count as "yes"; the count names each. */
function cyberArkCount(safes: number, policies: number): string | null {
  const parts: string[] = [];
  if (safes > 0) parts.push(plural(safes, 'Safe', 'Safes'));
  if (policies > 0) parts.push(plural(policies, 'política SIA', 'políticas SIA'));
  return parts.length ? parts.join(' · ') : null;
}

export function personPlatformAnswer(source: PersonNodeId, tool: PersonToolSummary | undefined, sia?: PersonToolSummary): PersonPlatformAnswer {
  if (!tool) return { answer: 'unknown', label: t('Sin permiso de lectura'), count: null, tone: 'neutral' };
  const policies = source === 'pam' ? siaPolicyCount(sia) : 0;
  if (tool.status === 'unmatched') {
    if (source === 'pam' && hasRoleAccess(tool)) {
      return { answer: 'yes', label: t('Con acceso por rol'), count: cyberArkCount(tool.role_access!.safes, policies), tone: 'info' };
    }
    if (policies > 0) return { answer: 'yes', label: t('Acceso por SIA'), count: cyberArkCount(0, policies), tone: 'info' };
    return { answer: 'no', label: source === 'pam' ? t('Sin acceso registrado') : t('Sin cliente registrado'), count: null, tone: 'neutral' };
  }
  if (tool.status === 'ambiguous') return { answer: 'ambiguous', label: t('Vínculo ambiguo'), count: null, tone: 'warning' };
  if (tool.status === 'reference') return { answer: 'reference', label: t('Referencia por nombre'), count: null, tone: 'info' };
  if (source === 'pam') {
    const safes = tool.totals?.safes;
    if (tool.user?.suspended) return { answer: 'yes', label: t('Usuario suspendido'), count: cyberArkCount(safes ?? 0, policies), tone: 'warning' };
    if (safes === undefined || safes === null) return { answer: 'yes', label: t('Usuario de CyberArk'), count: cyberArkCount(0, policies), tone: 'success' };
    if (safes === 0 && policies > 0) return { answer: 'yes', label: t('Acceso por SIA'), count: cyberArkCount(0, policies), tone: 'success' };
    if (safes === 0) return { answer: 'no', label: t('Usuario sin Safes'), count: null, tone: 'neutral' };
    return { answer: 'yes', label: t('Con acceso privilegiado'), count: cyberArkCount(safes, policies), tone: 'success' };
  }
  const recent = tool.device_count ?? 0;
  const stale = tool.stale_device_count ?? 0;
  if (recent > 0) return { answer: 'yes', label: t('Cliente activo'), count: plural(recent, 'equipo reciente', 'equipos recientes'), tone: 'success' };
  if (stale > 0) return { answer: 'no', label: t('Cliente sin actividad reciente'), count: plural(stale, 'equipo', 'equipos'), tone: 'warning' };
  return { answer: 'no', label: t('Sin equipos'), count: null, tone: 'neutral' };
}

/** The platforms a search result has a record in: Identity and SIA belong to CyberArk. */
export function personPlatformSources(sources: readonly PersonSource[]): string[] {
  const platforms: string[] = [];
  if (sources.some((source) => source === 'pam' || source === 'identity' || source === 'sia')) platforms.push('CyberArk');
  if (sources.includes('netskope')) platforms.push('Netskope');
  return platforms;
}
