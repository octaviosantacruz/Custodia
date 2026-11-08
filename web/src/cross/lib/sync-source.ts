import { REGISTERED_SYNCS, REGISTERED_RUNTIMES, SYNC_BY_SOURCE } from '../../sources.ts';
import { CATALOG_BY_ID } from './workspace-catalog.ts';
import { domainOf, type Domain } from './domains.ts';
import type { WorkspaceView } from './workspaces.ts';
import { t, localeTag } from '../i18n/index.ts';

export type SyncSource = 'cyberark' | 'identity_administration' | 'sia' | 'access' | 'netskope' | string;
export type SyncSourceMeta = { label: string; image?: string; fallback: string };

const TOOL_META = Object.fromEntries(REGISTERED_SYNCS.map((sync) => [sync.tool, sync.toolMeta]));
const HINTED_SYNCS = [...REGISTERED_SYNCS].sort((left, right) => (left.hintOrder ?? 0) - (right.hintOrder ?? 0));
const STATUS_LABELS: Record<string, string> = {
  queued: 'En espera',
  running: 'Ejecutando',
  partial: 'Con avisos',
  completed: 'Completada',
  failed: 'Fallida',
};

/** Spanish label for an ingestion run status. UX-AUD-009: the UI must never
 *  print the raw enum ("Última sincronización completed"); shared by the
 *  workspace intro and the runs view. Unknown values stay visible as-is
 *  rather than hiding a status the contract does not define yet. */
export function syncStatusLabel(status: string | null | undefined): string {
  if (!status) return t('Sin estado');
  return STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : status;
}

export function syncSourceLabel(source: SyncSource | null | undefined, sourceFile?: string | null): string {
  const directLabel = SYNC_BY_SOURCE[source || '']?.meta.label;
  if (directLabel) return directLabel;
  const hint = `${source || ''} ${sourceFile || ''}`.toLocaleLowerCase('es');
  const hinted = HINTED_SYNCS.find((sync) => sync.sourceHints?.some((word) => hint.includes(word)));
  if (hinted) return hinted.meta.label;
  return source || 'Sincronización';
}

/** Tool-level identity used by operator-facing synchronization summaries.
 * Feature/source labels remain available separately for audit detail. */
/** The sync source a navigation area belongs to (`pam` -> CyberArk, `dlp` -> Netskope); null for Custodia-level areas. */
export function syncSourceForArea(area: Domain): SyncSource | null {
  return REGISTERED_SYNCS.find((sync) => sync.domain === area)?.source ?? null;
}

export function syncToolForSource(source: SyncSource | null | undefined): SyncSource | null {
  return SYNC_BY_SOURCE[source || '']?.tool ?? source ?? null;
}

export function syncToolLabel(tool: SyncSource | null | undefined): string {
  const meta = TOOL_META[tool || ''];
  if (meta) return meta.label;
  return tool || 'Sincronización';
}

/** Tool-level logo and fallback mark. Feature metadata remains separate for
 * audit and component-level detail. */
export function syncToolMeta(tool: SyncSource | null | undefined): SyncSourceMeta {
  const meta = TOOL_META[tool || ''];
  if (meta) return meta;
  const key = tool || '';
  return { label: syncToolLabel(tool), fallback: key.slice(0, 1).toUpperCase() || 'S' };
}

/** Collapse feature sources into the distinct tools represented by a sync. */
export function syncToolsForSources(sources: readonly (SyncSource | null | undefined)[]): SyncSource[] {
  return [...new Set(sources.map(syncToolForSource).filter((tool): tool is SyncSource => tool !== null))];
}

/** Sources a manual refresh will touch before the server answers. `all` is every
 *  registered tool (CyberArk and Netskope); `cyberark` is CyberArk alone. The
 *  server decides which are configured and the toast narrows to the real runs. */
export function syncSourcesForScope(scope: 'all' | 'cyberark'): SyncSource[] {
  if (scope === 'cyberark') return ['cyberark'];
  return syncToolsForSources(REGISTERED_SYNCS.map((sync) => sync.source));
}

export type SyncToolPlan = { tool: SyncSource; label: string; components: string[] };

/** What a manual refresh of `scope` will queue, grouped by tool and read from the
 *  source registry, so a new tool or component appears without editing any screen. */
export function syncPlanForScope(scope: 'all' | 'cyberark'): SyncToolPlan[] {
  return syncSourcesForScope(scope).map((tool) => ({
    tool,
    label: syncToolLabel(tool),
    components: [...new Set(REGISTERED_SYNCS
      .filter((sync) => sync.tool === tool)
      .flatMap((sync) => [sync.componentLabel, ...Object.values(sync.componentLabelsByFile ?? {})]))],
  }));
}

function syncComponentLabel(source: SyncSource | null | undefined, sourceFile?: string | null): string {
  const sync = SYNC_BY_SOURCE[source || ''];
  if (sync) return sync.componentLabelsByFile?.[sourceFile || ''] ?? sync.componentLabel;
  return syncSourceLabel(source, sourceFile);
}

export type SyncRunForGrouping = {
  source_system?: SyncSource | null;
  source_file?: string | null;
  status: string;
  enqueued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  heartbeat_at?: string | null;
  status_message?: string | null;
  received_object_count?: number | null;
  received_safe_count?: number | null;
  triggered_by?: string | null;
  error_count?: number | null;
  attempt_count?: number | null;
};

export type SyncRunGroup<T extends SyncRunForGrouping> = {
  tool: SyncSource | null;
  status: string;
  runs: T[];
  components: Array<{ label: string; status: string; objects: number; runs: T[] }>;
  affectedComponents: Array<{ label: string; status: 'failed' | 'partial' }>;
  received_object_count: number;
  latest_at: string | null;
  heartbeat_at: string | null;
  automatic: boolean;
};

const RUN_STATUS_PRIORITY: Record<string, number> = {
  running: 5,
  failed: 4,
  partial: 3,
  queued: 2,
  completed: 1,
};
const SYNC_CYCLE_WINDOW_MS = 15 * 60 * 1000;

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cycleTimestamp(run: SyncRunForGrouping): number | null {
  return timestamp(run.enqueued_at) ?? timestamp(run.started_at);
}

function mostRecentStatus(runs: readonly SyncRunForGrouping[]): string {
  return runs.reduce((status, run) => (RUN_STATUS_PRIORITY[run.status] || 0) > (RUN_STATUS_PRIORITY[status] || 0) ? run.status : status, runs[0]?.status || '');
}

function runObjects(run: SyncRunForGrouping): number {
  const count = run.received_object_count || run.received_safe_count || 0;
  return Number.isFinite(count) ? count : 0;
}

/** Group source runs for a single tool cycle. Each 15-minute window is
 * anchored at its newest enqueued_at (or started_at), not extended by chaining
 * successive runs, so a long sequence cannot collapse into one row. */
export function groupSyncRunsByToolCycle<T extends SyncRunForGrouping>(runs: readonly T[]): SyncRunGroup<T>[] {
  const ordered = runs.map((run, index) => ({ run, index, tool: syncToolForSource(run.source_system), cycleAt: cycleTimestamp(run) }))
    .sort((left, right) => (right.cycleAt ?? Number.NEGATIVE_INFINITY) - (left.cycleAt ?? Number.NEGATIVE_INFINITY) || left.index - right.index);
  const buckets: Array<{ tool: SyncSource | null; cycleAt: number | null; runs: T[] }> = [];

  for (const entry of ordered) {
    const bucket = entry.cycleAt === null ? undefined : buckets.find((candidate) =>
      candidate.tool === entry.tool && candidate.cycleAt !== null && candidate.cycleAt >= entry.cycleAt! && candidate.cycleAt - entry.cycleAt! <= SYNC_CYCLE_WINDOW_MS,
    );
    if (bucket) bucket.runs.push(entry.run);
    else buckets.push({ tool: entry.tool, cycleAt: entry.cycleAt, runs: [entry.run] });
  }

  return buckets.map(({ tool, runs: groupedRuns }) => {
    const componentMap = new Map<string, { label: string; runs: T[] }>();
    for (const run of groupedRuns) {
      const label = syncComponentLabel(run.source_system, run.source_file);
      const component = componentMap.get(label) || { label, runs: [] };
      component.runs.push(run);
      componentMap.set(label, component);
    }
    const components = [...componentMap.values()].map(({ label, runs: componentRuns }) => ({
      label,
      status: mostRecentStatus(componentRuns),
      objects: componentRuns.reduce((total, run) => total + runObjects(run), 0),
      runs: componentRuns,
    }));
    const affectedComponents = components.flatMap(({ label, runs: componentRuns }): Array<{ label: string; status: 'failed' | 'partial' }> => {
      if (componentRuns.some((run) => run.status === 'failed')) return [{ label, status: 'failed' as const }];
      if (componentRuns.some((run) => run.status === 'partial' || (run.status === 'completed' && (run.error_count || 0) > 0))) {
        return [{ label, status: 'partial' as const }];
      }
      return [];
    });
    const datedRuns = groupedRuns.map((run) => {
      const value = run.completed_at || run.started_at || run.enqueued_at || null;
      return { value, at: timestamp(value) };
    }).filter((entry): entry is { value: string; at: number } => Boolean(entry.value) && entry.at !== null)
      .sort((left, right) => right.at - left.at);
    const activeHeartbeats = groupedRuns.filter((run) => run.status === 'running' && run.heartbeat_at && timestamp(run.heartbeat_at) !== null)
      .sort((left, right) => (timestamp(right.heartbeat_at) || 0) - (timestamp(left.heartbeat_at) || 0));

    return {
      tool,
      status: mostRecentStatus(groupedRuns),
      runs: groupedRuns,
      components,
      affectedComponents,
      received_object_count: groupedRuns.reduce((total, run) => total + runObjects(run), 0),
      latest_at: datedRuns[0]?.value || null,
      heartbeat_at: activeHeartbeats[0]?.heartbeat_at || null,
      automatic: groupedRuns.every((run) => run.triggered_by === 'system:scheduler'),
    };
  });
}

export function syncSourceMeta(source: SyncSource | null | undefined, sourceFile?: string | null): SyncSourceMeta {
  const key = source || '';
  return SYNC_BY_SOURCE[key]?.meta || { label: syncSourceLabel(source, sourceFile), fallback: key.slice(0, 1).toUpperCase() || 'S' };
}

/** The product that owns a synchronization source. CyberArk's auxiliary
 * services remain inside PAM; Netskope is an independent DLP product. */
export function syncDomainForSource(source: SyncSource | null | undefined): Domain | null {
  return SYNC_BY_SOURCE[source || '']?.domain ?? null;
}

/** True only when a completed source can refresh the workspace being viewed.
 * This keeps automatic updates seamless and prevents one product from
 * remounting or reloading another product's inventory. */
export function refreshDomainForSync(activeDomain: Domain, source: SyncSource | null | undefined): boolean {
  return syncDomainForSource(source) === activeDomain;
}

/** A polling response may contain concurrent terminal runs. Refresh the
 * workspace when any of those runs belongs to its product domain. */
export function refreshDomainForEvents(activeDomain: Domain, sources: readonly (SyncSource | null | undefined)[]): boolean {
  return sources.some((source) => refreshDomainForSync(activeDomain, source));
}

/** Resolve the target from the workspace visible when an async run lookup
 * finishes, never from the workspace that started the lookup. */
export function refreshDomainForVisibleWorkspace(
  workspaceView: WorkspaceView,
  sources: readonly (SyncSource | null | undefined)[],
): Domain | null {
  const visibleDomain = domainOf(workspaceView);
  return refreshDomainForEvents(visibleDomain, sources) ? visibleDomain : null;
}

export function refreshKeyForVisibleWorkspace(
  workspaceView: WorkspaceView,
  sources: readonly (SyncSource | null | undefined)[],
): Domain | null {
  const domain = refreshDomainForVisibleWorkspace(workspaceView, sources);
  return REGISTERED_RUNTIMES.some((runtime) => runtime.refreshDomain === domain) ? domain : null;
}

/** Background syncs should refresh only the workspace that owns the source.
 * CyberArk's auxiliary sources are intentionally not treated as a wildcard
 * for every PAM screen: an SIA update must not disturb a user reviewing Safes. */
export function refreshVisibleWorkspaceForSources(
  workspaceView: WorkspaceView,
  sources: readonly (SyncSource | null | undefined)[],
): boolean {
  const expected = CATALOG_BY_ID[workspaceView].refreshSources;
  return Boolean(expected && sources.some((source) => source && expected.includes(source)));
}

/** Resolve the product that owns a human-facing operational notice.
 *
 * Notices predate structured metadata, so the conservative fallback remains
 * the generic Custodia check when neither product is named. PAM/Safes are part
 * of the CyberArk domain; Netskope is only selected when it is explicit.
 */
export function syncSourceFromNotice(notice: string): SyncSource | null {
  const normalized = notice.toLocaleLowerCase('es');
  // A Custodia batch can name more than one product. Do not give that shared
  // result the icon/eyebrow of whichever source happens to be mentioned
  // first in its detail.
  if (normalized.startsWith('custodia terminó una sincronización automática') || normalized.startsWith('custodia sincronizó')) return null;
  const hinted = HINTED_SYNCS.find((sync) => sync.noticeHints?.some((word) => normalized.includes(word)));
  if (hinted) return hinted.source;
  return null;
}

export type NoticePresentation = {
  source: SyncSource | null;
  eyebrow: string;
  title: string;
  detail?: string;
};

/** Keep automatic-sync notices scannable without changing the stored message
 * contract used by auth, activity and workspace actions. */
export function presentNotice(notice: string, workspaceSource: SyncSource | null = null): NoticePresentation {
  const source = syncSourceFromNotice(notice) ?? workspaceSource;
  const sourceLabel = source ? syncToolLabel(syncToolForSource(source)) : null;
  const eyebrow = sourceLabel ? `${sourceLabel} · ACTUALIZACIÓN` : 'CUSTODIA · ACTUALIZACIÓN';
  const automatic = /sincronización automática|sincronizó automáticamente|sincronizó parcialmente/i.test(notice);
  if (!automatic) return { source, eyebrow, title: notice };

  const withoutSource = sourceLabel && notice.startsWith(sourceLabel)
    ? notice.slice(sourceLabel.length).trim()
    : notice;
  const automaticBody = withoutSource.replace(/^Custodia\s+/i, '');
  const completed = automaticBody.match(/^sincronizó automáticamente (.+?)\. (.+)$/i);
  if (completed) {
    return {
      source,
      eyebrow,
      title: t('Sincronización automática completada'),
      detail: `${completed[1]} · ${completed[2]}`,
    };
  }

  const failed = automaticBody.match(/^terminó una sincronización automática con errores\. (.+)$/i);
  if (failed) return { source, eyebrow, title: t('Sincronización automática con errores'), detail: failed[1] };

  const partial = automaticBody.match(/^sincronizó parcialmente: (.+)$/i);
  if (partial) return { source, eyebrow, title: t('Sincronización automática parcial'), detail: partial[1] };

  const finished = automaticBody.match(/^terminó una sincronización automática\. (.+)$/i);
  if (finished) return { source, eyebrow, title: t('Sincronización automática finalizada'), detail: finished[1] };
  return { source, eyebrow, title: t('Sincronización automática finalizada'), detail: withoutSource };
}

type CompletedSync = {
  source_system?: SyncSource;
  status: string;
  received_object_count?: number | null;
  received_safe_count?: number | null;
  error_count?: number | null;
};

export function automaticSyncNotice(run: CompletedSync): string {
  const source = syncToolLabel(syncToolForSource(run.source_system));
  const objects = run.received_object_count ?? run.received_safe_count;
  if (run.status === 'partial') {
    const landed = typeof objects === 'number' ? ` Llegaron ${objects.toLocaleString(localeTag())} ${objects === 1 ? 'objeto' : 'objetos'}.` : '';
    return `${source} sincronizó parcialmente: parte del inventario no se actualizó.${landed} Tu vista actual se conserva; revisá Actividad.`;
  }
  if (run.status !== 'completed' || (run.error_count || 0) > 0) {
    return `${source} terminó una sincronización automática con errores. Tu vista actual se conserva; revisá Actividad para el detalle.`;
  }
  if (typeof objects !== 'number') return `${source} terminó una sincronización automática. Tu vista actual se conserva.`;
  return `${source} sincronizó automáticamente ${objects.toLocaleString(localeTag())} ${objects === 1 ? 'objeto' : 'objetos'}. Tu vista actual se conserva.`;
}

/** Collapse the several source runs that make up one scheduled CyberArk pass
 * into one human-facing toast. Auxiliary successful runs stay in Actividad,
 * but do not interrupt the operator with a second success banner. */
export function automaticSyncBatchNotice(runs: readonly CompletedSync[]): string | null {
  if (!runs.length) return null;
  if (runs.length === 1) {
    const run = runs[0];
    if (run.status === 'completed' && !(run.error_count || 0) && SYNC_BY_SOURCE[run.source_system || '']?.quietAutomaticSuccess) return null;
    return automaticSyncNotice(run);
  }
  const labels = [...new Set(runs.map((run) => syncToolLabel(syncToolForSource(run.source_system))))];
  const failed = runs.some((run) => (run.status !== 'completed' && run.status !== 'partial') || (run.error_count || 0) > 0);
  if (failed) return `Custodia terminó una sincronización automática con errores. ${labels.join(', ')}; revisá Actividad para el detalle.`;
  if (runs.some((run) => run.status === 'partial')) return `Custodia sincronizó parcialmente: ${labels.join(', ')}. Tu vista actual se conserva; revisá Actividad.`;
  if (labels.length === 1) return `${labels[0]} sincronizó automáticamente. Tu vista actual se conserva.`;
  return `Custodia terminó una sincronización automática. Herramientas actualizadas: ${labels.join(', ')}. Tu vista actual se conserva.`;
}
