import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, RefreshCw, Search, Settings2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { searchInventory, type SearchResult } from '../lib/search-api';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { useHotkey } from '../hooks/use-hotkey';
import { useWidgetCommands } from '../hooks/use-widget-commands';
import {
  commandShortcutLabel, emptyStateSections, matchesCommandFilters, rankCommands, SEARCH_RESULT_META,
  type CommandCenterCommand, type CommandKind, type CommandPlatform, type CommandPlatformFilter,
} from '../lib/command-center';
import { WORKSPACE_ICONS } from '../lib/workspace-meta';
import { canonicalWorkspaceList, type WorkspaceView } from '../lib/workspaces';
import type { WorkspacePreferences } from '../lib/workspace-preferences-api';

const KIND_LABELS: Record<CommandKind, string> = {
  view: 'Vista',
  action: 'Acción',
  widget: 'Widget',
  inventory: 'Inventario',
};

// Stable fallback so `groupedRemote` and `options` are not recomputed on every render.
const NO_RESULTS: SearchResult[] = [];

const PLATFORM_LABELS: Record<CommandPlatform, string> = {
  cyberark: 'CyberArk',
  netskope: 'Netskope',
  dshub: 'DS Hub',
};

const PLATFORM_FILTERS: ReadonlyArray<{ value: CommandPlatformFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'cyberark', label: 'CyberArk' },
  { value: 'netskope', label: 'Netskope' },
  { value: 'dshub', label: 'DS Hub' },
];

type GlobalSearchProps = {
  includeInternal?: boolean;
  permissions: string[];
  commands: CommandCenterCommand[];
  preferences: WorkspacePreferences;
  onWorkspaceSelect: (view: WorkspaceView) => void;
  onSelect: (result: SearchResult) => void;
};

type SearchOption =
  | { key: string; source: 'command'; command: CommandCenterCommand }
  | { key: string; source: 'result'; result: SearchResult };

function commandIcon(command: CommandCenterCommand): LucideIcon | null {
  if (command.kind === 'widget') return LayoutGrid;
  if (command.workspace) return WORKSPACE_ICONS[command.workspace];
  if (command.kind === 'action') return command.id === 'action-catalogs' ? Settings2 : RefreshCw;
  return null;
}

function CommandBadges({ kind, platform }: { kind: CommandKind; platform?: CommandPlatform }) {
  /* "Vista" is the default kind, so labelling every row with it is noise:
     only the kinds that differ (Acción, Widget, Inventario) get a badge. */
  const showKind = kind !== 'view';
  if (!showKind && !platform) return null;
  return <span className="global-search-badges">
    {showKind ? <span className="global-search-badge">{KIND_LABELS[kind]}</span> : null}
    {platform ? <span className="global-search-badge">{PLATFORM_LABELS[platform]}</span> : null}
  </span>;
}

export function GlobalSearch({ includeInternal = true, permissions, commands, preferences, onWorkspaceSelect, onSelect }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [platformFilter, setPlatformFilter] = useState<CommandPlatformFilter>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutLabel = commandShortcutLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  /* The remote inventory search stays debounced on the raw query; local
     ranking/filtering uses the deferred value so typing never blocks. */
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();
  const remoteQuery = query.trim();

  const quickAccessViews = useMemo(() => canonicalWorkspaceList(preferences.visible_workspaces), [preferences.visible_workspaces]);
  const recentViews = useMemo(() => canonicalWorkspaceList(preferences.recent_workspaces), [preferences.recent_workspaces]);
  /* Bundle-size follow-up to UX-SEARCH-001: the PAM/Netskope widget catalogs
     load lazily (see use-widget-commands.ts) only while the dialog is open,
     merged into the eager view/action commands. `commands` (from `widget`)
     stays empty -- never partial/guessed -- until the load resolves. */
  const { commands: widgetOnlyCommands, status: widgetsStatus, ensureLoaded: ensureWidgetSources } = useWidgetCommands(permissions, open);
  const allCommands = useMemo(
    () => [...commands, ...widgetOnlyCommands],
    [commands, widgetOnlyCommands],
  );
  const rankedCommands = useMemo(
    () => rankCommands(allCommands, trimmedQuery, permissions, { recentIds: recentViews }),
    [allCommands, trimmedQuery, permissions, recentViews],
  );
  const localCommands = useMemo(
    () => rankedCommands.filter((command) => matchesCommandFilters(command, platformFilter, 'all')),
    [rankedCommands, platformFilter],
  );
  const remoteResults = useMemo(
    () => results.filter((result) => matchesCommandFilters(SEARCH_RESULT_META[result.type], platformFilter, 'all')),
    [results, platformFilter],
  );
  const sections = useMemo(
    // emptyStateSections already excludes widget-kind commands from the
    // empty-query browsing state, so passing allCommands here is harmless.
    () => trimmedQuery ? [] : emptyStateSections(allCommands, permissions, quickAccessViews, recentViews, { platform: platformFilter, kind: 'all' }),
    [allCommands, trimmedQuery, permissions, quickAccessViews, recentViews, platformFilter],
  );
  const remoteSearchable = remoteQuery.length >= 2;
  const widgetsRelevant = true;
  const visibleRemote = remoteSearchable ? remoteResults : NO_RESULTS;
  const groupedRemote = useMemo(() => Array.from(visibleRemote.reduce((groups, result) => {
    const items = groups.get(result.type) ?? [];
    if (!items.length) groups.set(result.type, items);
    items.push(result);
    return groups;
  }, new Map<SearchResult['type'], SearchResult[]>()).entries()), [visibleRemote]);

  const options = useMemo<SearchOption[]>(() => trimmedQuery
    ? [
      ...localCommands.map((command): SearchOption => ({ key: command.id, source: 'command', command })),
      ...visibleRemote.map((result): SearchOption => ({ key: `${result.type}-${result.target}`, source: 'result', result })),
    ]
    : sections.flatMap((section) => section.groups.flatMap((group) => group.commands.map((command): SearchOption => ({ key: command.id, source: 'command', command })))),
  [localCommands, sections, trimmedQuery, visibleRemote]);
  const optionIndexByKey = useMemo(() => new Map(options.map((option, index) => [option.key, index])), [options]);
  const safeActiveIndex = options.length ? Math.min(activeIndex, options.length - 1) : 0;

  const close = () => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setActiveIndex(0);
    setSearchError('');
    setPlatformFilter('all');
  };

  // UX-AUD-002: the command center declares aria-modal="true", so it owns the
  // shared trap: focus starts at the search input, Tab/Shift+Tab cycle inside
  // the dialog, Escape closes it and focus returns to the trigger. The portal
  // lives on document.body, so the hook's inert walk covers the whole app.
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ active: open, onClose: close, initialFocusRef: inputRef });

  useHotkey(() => setOpen(true));

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      setSearchError('');
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setSearchError('');
      void searchInventory(query.trim(), includeInternal)
        .then((response) => {
          if (cancelled) return;
          setResults(Object.values(response.groups).flat());
          setActiveIndex(0);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setSearchError('No se pudo completar la búsqueda. Probá de nuevo.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [includeInternal, open, query]);

  /* A filter or query change can drop the selected option: reset the index so
     the active descendant always points at a rendered result. */
  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery, platformFilter, open]);

  const runCommand = (command: CommandCenterCommand) => {
    close();
    if (command.run) command.run();
    else if (command.workspace) onWorkspaceSelect(command.workspace);
  };

  const selectResult = (result: SearchResult) => {
    close();
    onSelect(result);
  };

  const handleKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (!options.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (Math.min(index, options.length - 1) + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (options.length + Math.min(index, options.length - 1) - 1) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[safeActiveIndex];
      if (!option) return;
      if (option.source === 'command') runCommand(option.command);
      else selectResult(option.result);
    }
  };

  const renderCommandOption = (command: CommandCenterCommand) => {
    const index = optionIndexByKey.get(command.id) ?? 0;
    const active = safeActiveIndex === index;
    const Icon = commandIcon(command);
    return <button
      id={`global-search-result-${index}`}
      key={command.id}
      type="button"
      role="option"
      aria-selected={active}
      className={active ? 'active' : ''}
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => runCommand(command)}
    >
      {Icon ? <Icon className="global-search-option-icon" size={16} aria-hidden /> : null}
      <span className="global-search-option-copy">
        <span className="global-search-option-heading"><strong>{command.label}</strong><CommandBadges kind={command.kind} platform={trimmedQuery ? command.platform : undefined} /></span>
        {command.detail !== command.label ? <span>{command.detail}</span> : null}
      </span>
    </button>;
  };

  const renderResultOption = (result: SearchResult) => {
    const index = optionIndexByKey.get(`${result.type}-${result.target}`) ?? 0;
    const active = safeActiveIndex === index;
    return <button
      id={`global-search-result-${index}`}
      key={`${result.type}-${result.target}`}
      type="button"
      role="option"
      aria-selected={active}
      className={active ? 'active' : ''}
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => selectResult(result)}
    >
      <span className="global-search-option-copy">
        <span className="global-search-option-heading"><strong>{result.label}</strong></span>
        {result.detail && result.detail !== result.label ? <span>{result.detail}</span> : null}
      </span>
    </button>;
  };

  return <>
    <button
      className="button subtle global-search-trigger"
      type="button"
      onClick={() => setOpen(true)}
      onMouseEnter={() => void ensureWidgetSources().catch(() => {})}
      onFocus={() => void ensureWidgetSources().catch(() => {})}
      aria-label="Abrir command center"
      title={`Buscar inventario, herramientas y acciones (${shortcutLabel})`}
    >
      <Search size={16} aria-hidden />
      <span>Buscar</span>
      <kbd>{shortcutLabel}</kbd>
    </button>
    {open && createPortal(
      <div ref={dialogRef} className="global-search-layer" role="dialog" aria-modal="true" aria-label="Command center">
        <button className="global-search-backdrop" type="button" aria-label="Cerrar búsqueda" onClick={close} />
        <section className="global-search-panel">
          <div className="global-search-input">
            <Search size={18} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Buscar inventario, herramientas y acciones"
              aria-controls="global-search-results"
              aria-expanded="true"
              aria-activedescendant={options[safeActiveIndex] ? `global-search-result-${safeActiveIndex}` : undefined}
              placeholder="Buscar inventario, herramientas o acciones"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeys}
            />
            <button className="icon-button" type="button" aria-label="Cerrar búsqueda" title="Cerrar búsqueda" onClick={close}><X size={16} aria-hidden /></button>
          </div>
          <div className="global-search-filters">
            <div className="global-search-chip-group" role="group" aria-label="Filtrar por plataforma">
              <span className="global-search-chip-label">Plataforma</span>
              {PLATFORM_FILTERS.map((filter) => <button
                key={filter.value}
                className="global-search-chip"
                type="button"
                aria-pressed={platformFilter === filter.value}
                onClick={() => setPlatformFilter(filter.value)}
              >{filter.label}</button>)}
            </div>
          </div>
          <div className="global-search-results">
            {trimmedQuery && loading && remoteSearchable ? <p className="global-search-empty" role="status">Buscando…</p> : null}
            {trimmedQuery && searchError ? <p className="global-search-empty" role="alert">{searchError}</p> : null}
            {/* Widgets load lazily: while a query/filter could still surface
               them, an incomplete widget list is never presented as final --
               a loading (or error) state takes over the "no matches" message
               below instead. */}
            {trimmedQuery && widgetsRelevant && widgetsStatus === 'loading' ? <p className="global-search-empty" role="status">Cargando widgets…</p> : null}
            {trimmedQuery && widgetsRelevant && widgetsStatus === 'error' ? <p className="global-search-empty" role="alert">No se pudieron cargar los widgets. Probá de nuevo.</p> : null}
            <div id="global-search-results" role="listbox" aria-label="Resultados del command center">
              {!trimmedQuery ? (sections.length
                ? sections.map((section) => <div className="global-search-group" key={section.id} role="group" aria-label={section.label}>
                  <h2 aria-hidden="true">{section.label}</h2>
                  {section.groups.map((group) => <div key={group.platform} role="group" aria-label={PLATFORM_LABELS[group.platform]}>
                    <h3 className="global-search-subgroup" aria-hidden="true">{PLATFORM_LABELS[group.platform]}</h3>
                    {group.commands.map(renderCommandOption)}
                  </div>)}
                </div>)
                : null)
                : <>
                  {localCommands.length ? <div className="global-search-group" role="group" aria-label="Resultados">
                    <h2 aria-hidden="true">Resultados</h2>
                    {localCommands.map(renderCommandOption)}
                  </div> : null}
                  {groupedRemote.map(([type, items]) => <div className="global-search-group" key={type} role="group" aria-label={SEARCH_RESULT_META[type].groupLabel}>
                    <h2 aria-hidden="true">{SEARCH_RESULT_META[type].groupLabel}</h2>
                    {items.map(renderResultOption)}
                  </div>)}
                </>}
            </div>
            {!trimmedQuery && !sections.length ? <p className="global-search-empty">No hay destinos disponibles.</p> : null}
            {trimmedQuery && !loading && !searchError && !(widgetsRelevant && (widgetsStatus === 'loading' || widgetsStatus === 'error')) && !localCommands.length && !visibleRemote.length
              ? <p className="global-search-empty">{remoteSearchable ? 'No se encontraron coincidencias.' : 'Ingresá al menos dos caracteres para buscar inventario.'}</p>
              : null}
          </div>
          <p className="global-search-help">↑↓ para seleccionar · Enter para abrir · Esc para cerrar</p>
        </section>
      </div>,
      document.body,
    )}
  </>;
}
