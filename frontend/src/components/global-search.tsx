import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, RefreshCw, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { searchInventory, type SearchResult } from '../lib/search-api';
import { useHotkey } from '../hooks/use-hotkey';
import { availableCommands, commandShortcutLabel, type CommandCenterCommand } from '../lib/command-center';
import { WORKSPACE_ICONS } from '../lib/workspace-meta';

const GROUP_LABELS: Record<SearchResult['type'] | CommandCenterCommand['group'], string> = {
  safe: 'Safes',
  account: 'Cuentas',
  pam_user: 'Usuarios PAM',
  pam_role: 'Roles PAM',
  sia_policy: 'Políticas SIA',
  identity_user: 'Usuarios de Identity Administration',
  identity_role: 'Roles de Identity Administration',
  connection: 'Conexiones',
  recent: 'Recientes',
  tools: 'Herramientas',
  actions: 'Acciones',
};

type GlobalSearchProps = {
  includeInternal?: boolean;
  permissions: string[];
  commands: CommandCenterCommand[];
  onSelect: (result: SearchResult) => void;
};

function commandIcon(command: CommandCenterCommand): LucideIcon | null {
  if (command.workspace) return WORKSPACE_ICONS[command.workspace];
  if (command.group === 'actions') return command.id === 'action-catalogs' ? Settings2 : RefreshCw;
  return null;
}

export function GlobalSearch({ includeInternal = true, permissions, commands, onSelect }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutLabel = commandShortcutLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const commandResults = availableCommands(commands, query, permissions)
    .filter((command) => query.trim() || command.group !== 'recent');
  const selectableResults = [...commandResults, ...results];

  const close = () => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setActiveIndex(0);
    setSearchError('');
  };

  useHotkey(() => setOpen(true));

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

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

  const select = (result: SearchResult) => {
    close();
    onSelect(result);
  };

  const handleKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (!selectableResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % selectableResults.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index + selectableResults.length - 1) % selectableResults.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = selectableResults[activeIndex];
      if (!('type' in result)) {
        close();
        result.run?.();
      } else {
        select(result);
      }
    }
  };

  const groupedResults = results.reduce<Record<string, SearchResult[]>>((groups, result) => {
    (groups[result.type] ||= []).push(result);
    return groups;
  }, {});
  let resultIndex = 0;

  return <>
    <button className="button subtle global-search-trigger" type="button" onClick={() => setOpen(true)} aria-label="Abrir command center" title={`Buscar inventario, herramientas y acciones (${shortcutLabel})`}>
      <Search size={16} aria-hidden />
      <span>Buscar</span>
      <kbd>{shortcutLabel}</kbd>
    </button>
    {open && createPortal(
      <div className="global-search-layer" role="dialog" aria-modal="true" aria-label="Command center">
        <button className="global-search-backdrop" type="button" aria-label="Cerrar búsqueda" onClick={close} />
        <section className="global-search-panel">
          <div className="global-search-input">
            <Search size={18} aria-hidden />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label="Buscar inventario, herramientas y acciones"
              aria-controls="global-search-results"
              aria-expanded="true"
              aria-activedescendant={selectableResults[activeIndex] ? `global-search-result-${activeIndex}` : undefined}
              placeholder="Buscar inventario, herramientas o acciones"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeys}
            />
            <button className="icon-button" type="button" aria-label="Cerrar búsqueda" title="Cerrar búsqueda" onClick={close}><X size={16} aria-hidden /></button>
          </div>
          <div id="global-search-results" className="global-search-results" role="listbox" aria-label="Resultados del command center">
            {query.trim().length < 2 && !commandResults.length
              ? <p className="global-search-empty">Ingresá al menos dos caracteres.</p>
              : loading
                ? <p className="global-search-empty" role="status">Buscando…</p>
                : selectableResults.length
                  ? <>{searchError && <p className="global-search-empty" role="alert">{searchError}</p>}{(['recent', 'tools', 'actions'] as const).map((group) => {
                    const items = commandResults.filter((command) => command.group === group);
                    if (!items.length) return null;
                    return <div className="global-search-group" key={group}>
                      <h2>{GROUP_LABELS[group]}</h2>
                      {items.map((command) => {
                        const index = resultIndex++;
                        const Icon = commandIcon(command);
                        return <button id={`global-search-result-${index}`} key={command.id} type="button" role="option" aria-selected={activeIndex === index} className={activeIndex === index ? 'active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => { close(); command.run?.(); }}>
                          {Icon ? <Icon className="global-search-option-icon" size={16} aria-hidden /> : null}
                          <span className="global-search-option-copy"><strong>{command.label}</strong><span>{command.detail}</span></span>
                        </button>;
                      })}
                    </div>;
                  })}{(Object.entries(groupedResults) as Array<[SearchResult['type'], SearchResult[]]>).map(([group, items]) => <div className="global-search-group" key={group}>
                    <h2>{GROUP_LABELS[group]}</h2>
                    {items.map((result) => {
                      const index = resultIndex++;
                      return <button id={`global-search-result-${index}`} key={`${result.type}-${result.target}`} type="button" role="option" aria-selected={activeIndex === index} className={activeIndex === index ? 'active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(result)}>
                        <span className="global-search-option-copy"><strong>{result.label}</strong><span>{result.detail}</span></span>
                      </button>;
                    })}
                  </div>)}</>
                  : <p className="global-search-empty" role={searchError ? 'alert' : undefined}>{searchError || 'No se encontraron coincidencias.'}</p>}
          </div>
          <p className="global-search-help">↑↓ para seleccionar · Enter para abrir · Esc para cerrar</p>
        </section>
      </div>,
      document.body,
    )}
  </>;
}
