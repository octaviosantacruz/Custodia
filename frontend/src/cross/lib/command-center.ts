import type { DashboardShortcut, NetskopeWidgetDefinition } from '../types/dashboard-widgets';
import type { SearchResult } from './search-api';
import { GUIDE_SECTIONS } from '../content/guide-sections.ts';
import { CATALOG_ENTRIES, type WorkspaceView } from './workspace-catalog.ts';
import { hasWorkspaceAccess } from './workspaces.ts';

/* The root source registry supplies actual tool widget definitions lazily;
   this module stays a pure adapter over neutral structural contracts. */
export type WidgetCommandSources = {
  cyberarkWidgets: readonly DashboardShortcut[];
  netskopeDataWidgets: readonly NetskopeWidgetDefinition[];
  netskopeChartWidgets: readonly NetskopeWidgetDefinition[];
};

/* UX-SEARCH-001: Command-K v2. Everything here is pure and deterministic so
   ranking, filters and the empty state are unit-testable without React. The
   navigation commands derive from the workspace catalog (label/detail/path
   stay in one place) plus this explicit metadata; nothing is inferred from
   label text. Imperative actions stay in App.tsx with the same metadata. */

export type CommandKind = 'view' | 'action' | 'widget' | 'inventory';
export type CommandPlatform = 'cyberark' | 'netskope' | 'custodia';

export type CommandCenterCommand = {
  id: string;
  kind: CommandKind;
  platform: CommandPlatform;
  label: string;
  detail: string;
  aliases: string[];
  priority: number;
  /* Only imperative actions (and any command added by hand) declare their own
     gate: catalog-derived views/widgets are already permission-filtered. */
  permission?: string | string[];
  workspace?: WorkspaceView;
  /* DOCS-PORTAL-001: help-section commands navigate to the guide and restore
     this section; `hideInEmptyState` keeps the section index out of the
     browse list (they stay fully searchable). */
  sectionId?: string;
  hideInEmptyState?: boolean;
  run?: () => void;
};

/* Navigable commands: one per advertised (catalog:true) workspace the actor
   can open. The gate is `hasWorkspaceAccess`, never a duplicated permission
   list, and the label/detail come straight from the catalog. */
export function navigationCommands(permissions: string[]): CommandCenterCommand[] {
  return CATALOG_ENTRIES
    .filter((entry) => entry.catalog && hasWorkspaceAccess(entry.id as WorkspaceView, permissions))
    .map((entry) => {
      const meta = entry.command;
      return {
        id: `view-${entry.id}`,
        kind: 'view' as const,
        platform: meta.platform,
        label: entry.label,
        detail: entry.detail,
        aliases: [...meta.aliases],
        priority: meta.priority,
        workspace: entry.id as WorkspaceView,
      };
    });
}

/* DOCS-PORTAL-001: one command per guide section, with that section's own
   title/summary so Command-K finds the same names as the guide navigation.
   Metadata is explicit (kind/platform), never parsed from the label; the App
   binds the run() that opens the guide at the requested section. */
export function guideCommands(): CommandCenterCommand[] {
  return GUIDE_SECTIONS.map((section) => ({
    id: `guide-${section.id}`,
    kind: 'view' as const,
    platform: 'custodia' as const,
    label: section.title,
    detail: section.summary,
    aliases: [...section.aliases],
    priority: section.priority,
    workspace: 'help' as WorkspaceView,
    sectionId: section.id,
    hideInEmptyState: true,
  }));
}

/* Widgets reuse the real dashboard definitions and stay navigable shortcuts:
   they never add, remove, reorder or persist a widget. Focus/scroll into the
   block has no safe contract yet, so the command only opens its dashboard.
   Pure adapter: `sources` is whatever the root source registry resolved,
   or `null` while a caller hasn't loaded them yet (or chooses not to), in
   which case there simply are no widget commands -- never a stale/partial
   guess at their shape. */
export function widgetCommands(permissions: string[], sources: WidgetCommandSources | null): CommandCenterCommand[] {
  if (!sources) return [];
  /* Widgets follow the same gate as their dashboard workspace: the PAM board
     keeps the legacy inventory:read requirement, Netskope accepts its read
     permission or access:manage (same as the netskope view). */
  const cyberarkWidgets: CommandCenterCommand[] = permissions.includes('inventory:read')
    ? sources.cyberarkWidgets.map((widget) => ({
      id: `widget-pam-${widget.id}`,
      kind: 'widget' as const,
      platform: 'cyberark' as const,
      label: widget.title,
      detail: widget.detail,
      aliases: ['widget', 'widgets'],
      priority: 60,
      workspace: 'general' as WorkspaceView,
    }))
    : [];
  const netskopeWidgets: CommandCenterCommand[] = hasWorkspaceAccess('netskope', permissions)
    ? [...sources.netskopeDataWidgets, ...sources.netskopeChartWidgets].map((widget) => ({
      id: `widget-netskope-${widget.id}`,
      kind: 'widget' as const,
      platform: 'netskope' as const,
      label: widget.title,
      detail: widget.description,
      aliases: ['widget', 'widgets'],
      priority: 60,
      workspace: 'netskope' as WorkspaceView,
    }))
    : [];
  return [...cyberarkWidgets, ...netskopeWidgets];
}

/* Explicit classification for the remote inventory groups the current
   `/api/search` contract returns. All of them are CyberArk tools; a new
   backend type without metadata fails the build instead of being guessed. */
export type InventoryResultMeta = { kind: 'inventory'; platform: CommandPlatform; groupLabel: string };

export const SEARCH_RESULT_META: Record<SearchResult['type'], InventoryResultMeta> = {
  safe: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Safes' },
  account: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Cuentas' },
  pam_user: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Usuarios PAM' },
  pam_role: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Roles PAM' },
  sia_policy: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Políticas SIA' },
  identity_user: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Usuarios de Identity Administration' },
  identity_role: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Roles de Identity Administration' },
  connection: { kind: 'inventory', platform: 'cyberark', groupLabel: 'Conexiones migradas' },
};

export function isCommandAvailable(command: Pick<CommandCenterCommand, 'permission'>, permissions: string[]): boolean {
  if (!command.permission) return true;
  const required = Array.isArray(command.permission) ? command.permission : [command.permission];
  return required.some((code) => permissions.includes(code));
}

/* Case/accent/space-insensitive normalization for both the query and the
   searchable targets. */
export function normalizeCommandQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type CommandMatchTier = 'exact' | 'prefix' | 'token' | 'partial';

function matchTier(targets: string[], normalized: string): CommandMatchTier | null {
  if (targets.some((target) => target === normalized)) return 'exact';
  if (targets.some((target) => target.startsWith(normalized))) return 'prefix';
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length && targets.some((target) => {
    const words = target.split(' ').filter(Boolean);
    return tokens.every((token) => words.some((word) => word.startsWith(token)));
  })) return 'token';
  if (targets.some((target) => target.includes(normalized))) return 'partial';
  return null;
}

/* Best match across the label and the declared aliases. The detail text is
   deliberately not searched: aliases are the explicit synonym contract. */
export function commandMatchTier(command: Pick<CommandCenterCommand, 'label' | 'aliases'>, query: string): CommandMatchTier | null {
  const normalized = normalizeCommandQuery(query);
  if (!normalized) return null;
  return matchTier([command.label, ...command.aliases].map(normalizeCommandQuery), normalized);
}

const MATCH_ORDER: Record<CommandMatchTier, number> = { exact: 0, prefix: 1, token: 2, partial: 3 };

/* Deterministic search order: match tier, editorial priority, recency (only
   among equal tier+priority) and finally the label for stability. */
export function rankCommands(
  commands: readonly CommandCenterCommand[],
  query: string,
  permissions: string[],
  options: { recentIds?: readonly WorkspaceView[] } = {},
): CommandCenterCommand[] {
  const normalized = normalizeCommandQuery(query);
  if (!normalized) return [];
  const recentIds = options.recentIds ?? [];
  return commands
    .filter((command) => isCommandAvailable(command, permissions))
    .map((command) => ({
      command,
      tier: commandMatchTier(command, normalized),
      recency: command.workspace ? recentIds.indexOf(command.workspace) : -1,
    }))
    .filter((entry): entry is { command: CommandCenterCommand; tier: CommandMatchTier; recency: number } => entry.tier !== null)
    .sort((left, right) => MATCH_ORDER[left.tier] - MATCH_ORDER[right.tier]
      || left.command.priority - right.command.priority
      || (left.recency < 0 ? Number.MAX_SAFE_INTEGER : left.recency) - (right.recency < 0 ? Number.MAX_SAFE_INTEGER : right.recency)
      || left.command.label.localeCompare(right.command.label, 'es'))
    .map((entry) => entry.command);
}

export type CommandPlatformFilter = CommandPlatform | 'all';
export type CommandKindFilter = CommandKind | 'all';

export function matchesCommandFilters(
  option: { kind: CommandKind; platform: CommandPlatform },
  platformFilter: CommandPlatformFilter,
  kindFilter: CommandKindFilter,
): boolean {
  if (platformFilter !== 'all' && option.platform !== platformFilter) return false;
  if (kindFilter !== 'all' && option.kind !== kindFilter) return false;
  return true;
}

export const COMMAND_PLATFORM_ORDER: readonly CommandPlatform[] = ['cyberark', 'netskope', 'custodia'];

export type CommandPlatformGroup = { platform: CommandPlatform; commands: CommandCenterCommand[] };
export type CommandEmptySection = { id: 'quick' | 'recent' | 'more'; label: string; groups: CommandPlatformGroup[] };

function platformGroups(commands: CommandCenterCommand[]): CommandPlatformGroup[] {
  return COMMAND_PLATFORM_ORDER
    .map((platform) => ({
      platform,
      commands: commands
        .filter((command) => command.platform === platform)
        .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label, 'es')),
    }))
    .filter((group) => group.commands.length > 0);
}

function uniqueViews(views: readonly WorkspaceView[]): WorkspaceView[] {
  return [...new Set(views)];
}

/* Empty query: quick access and recents grouped by platform (CyberArk →
   Netskope → Custodia), then the remaining authorized views and actions.
   Widgets are searchable shortcuts, not browsing destinations, so they stay
   out of the empty state; every returned section has at least one group. */
export function emptyStateSections(
  commands: readonly CommandCenterCommand[],
  permissions: string[],
  quickAccessViews: readonly WorkspaceView[],
  recentViews: readonly WorkspaceView[],
  filters: { platform: CommandPlatformFilter; kind: CommandKindFilter } = { platform: 'all', kind: 'all' },
): CommandEmptySection[] {
  const available = commands.filter((command) => isCommandAvailable(command, permissions)
    && command.kind !== 'widget'
    && !command.hideInEmptyState
    && matchesCommandFilters(command, filters.platform, filters.kind));
  const byWorkspace = new Map(available.filter((command) => command.workspace).map((command) => [command.workspace as WorkspaceView, command]));
  const quick = uniqueViews(quickAccessViews).flatMap((view) => byWorkspace.get(view) ?? []);
  const quickIds = new Set(quick.map((command) => command.id));
  const recent = uniqueViews(recentViews).flatMap((view) => {
    const command = byWorkspace.get(view);
    return command && !quickIds.has(command.id) ? [command] : [];
  });
  const recentIds = new Set(recent.map((command) => command.id));
  const more = available.filter((command) => !quickIds.has(command.id) && !recentIds.has(command.id));
  return [
    { id: 'quick' as const, label: 'Accesos rápidos', groups: platformGroups(quick) },
    { id: 'recent' as const, label: 'Recientes', groups: platformGroups(recent) },
    { id: 'more' as const, label: 'Más vistas y acciones', groups: platformGroups(more) },
  ].filter((section) => section.groups.length > 0);
}

export function commandShortcutLabel(userAgent: string): string {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘ K' : 'Ctrl K';
}

export function recordRecentWorkspace<T extends string>(view: T, recent: T[], limit = 8): T[] {
  return [view, ...recent.filter((item) => item !== view)].slice(0, limit);
}
