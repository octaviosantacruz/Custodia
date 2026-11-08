import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { NetskopeBaselineEditor, type NetskopeBaselineKind } from './netskope-baseline-editor';
import { NetskopeChangesPanel } from './netskope-operations';
import { NetskopeFleetBand, NetskopeFleetTable } from './netskope-fleet-overview';
import { useNetskopePanel } from '../hooks/use-netskope-panel';
import { fetchNetskopeClientEvents, fetchNetskopeDeviceChanges, fetchNetskopeDeviceFacets, fetchNetskopeDeviceReviewSummary, fetchNetskopeFleetGroups } from '../lib/netskope-api';
import { netskopeSyncStatement } from '../lib/netskope-sync-evidence';
import type { NetskopeDeviceQuery, NetskopeFleetGroupBy } from '../types/netskope';
import { t } from '../../../cross/i18n/index.ts';

type EquiposTab = 'fleet' | 'changes';

/** Deep link: ?tab=changes opens Cambios. */
function initialTab(): EquiposTab {
  return new URLSearchParams(window.location.search).get('tab') === 'changes' ? 'changes' : 'fleet';
}

function syncTabUrl(tab: EquiposTab) {
  const url = new URL(window.location.href);
  if (tab === 'changes') url.searchParams.set('tab', 'changes'); else url.searchParams.delete('tab');
  url.searchParams.delete('open');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

type NetskopeOperationsViewProps = {
  refreshKey?: number;
  canAdminBaselines: boolean;
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
  onNotice: (message: string) => void;
  onDrill: (query: NetskopeDeviceQuery) => void;
  onOpenPosture?: (checks: string[]) => void;
};

// Endpoint posture stays separate from the personal dashboard: every panel
// drills into inventory, while the parent workspace owns permissions/navigation.
export function NetskopeOperationsView({ refreshKey, canAdminBaselines, authChecked, authenticated, onUnauthorized, onNotice, onDrill, onOpenPosture }: NetskopeOperationsViewProps) {
  const [editingBaseline, setEditingBaseline] = useState<NetskopeBaselineKind | null>(null);
  const [baselineVersion, setBaselineVersion] = useState(0);
  const [osOptions, setOsOptions] = useState<string[]>([]);
  const enabled = authChecked && authenticated;
  const [tab, setTabState] = useState<EquiposTab>(initialTab);
  const setTab = (next: EquiposTab) => { setTabState(next); syncTabUrl(next); };
  const [groupBy, setGroupBy] = useState<NetskopeFleetGroupBy>('company');
  const fleet = useNetskopePanel({ cacheKey: ['fleet-groups', groupBy, baselineVersion], enabled, refreshKey, onUnauthorized, load: (signal) => fetchNetskopeFleetGroups(groupBy, signal) });
  const changes = useNetskopePanel({ cacheKey: ['device-changes'], enabled, refreshKey, onUnauthorized, load: fetchNetskopeDeviceChanges });
  const diagnosis = useNetskopePanel({ cacheKey: ['device-review-summary'], enabled, refreshKey, onUnauthorized, load: fetchNetskopeDeviceReviewSummary });
  const clientEvents = useNetskopePanel({ cacheKey: ['client-events'], enabled, refreshKey, onUnauthorized, load: fetchNetskopeClientEvents });
  // The summary already carries evidence for the Netskope inventory sync (not DLP or UCI).
  const sync = netskopeSyncStatement(diagnosis.data?.source_evidence);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchNetskopeDeviceFacets().then((facets) => {
      if (!cancelled) setOsOptions((facets.os || []).map((bucket) => bucket.key).filter((key) => key !== 'Sin dato'));
    }).catch(() => { if (!cancelled) setOsOptions([]); });
    return () => { cancelled = true; };
  }, [enabled, refreshKey]);

  return <>
    <section className="netskope-operations" aria-label={t('Equipos Netskope')}>
      {!sync.fresh && (!diagnosis.loading || diagnosis.data) ? <p className="nsk-fleet-sync-warning" role="status">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{sync.text} · Cifras del último inventario disponible.</span>
      </p> : null}
      <NetskopeFleetBand fleet={fleet.data} changes={changes.data} clientEvents={clientEvents.data} diagnosis={diagnosis.data} onDrill={onDrill} onOpenPosture={onOpenPosture} onOpenChanges={() => setTab('changes')} />
      <nav className="workspace-subnav workspace-subnav-nested" aria-label={t('Secciones de Equipos')} role="tablist" onKeyDown={handleTablistKeyDown}>
        {([['fleet', 'Flota'], ['changes', 'Cambios']] as const).map(([id, label]) => <button
          key={id} type="button" role="tab" id={`nsk-equipos-tab-${id}`} aria-controls={`nsk-equipos-panel-${id}`}
          aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''}
          onClick={() => setTab(id)}
        ><strong>{label}</strong></button>)}
      </nav>
      <div role="tabpanel" id={`nsk-equipos-panel-${tab}`} aria-labelledby={`nsk-equipos-tab-${tab}`}>
        {tab === 'fleet'
          ? <NetskopeFleetTable panel={fleet} groupBy={groupBy} onGroupBy={setGroupBy} canAdmin={canAdminBaselines} onDrill={onDrill} onEditBaseline={setEditingBaseline} />
          : <><h2 className="sr-only">{t('Cambios')}</h2><NetskopeChangesPanel panel={changes} onDrill={onDrill} /></>}
      </div>
    </section>
    {editingBaseline ? <NetskopeBaselineEditor kind={editingBaseline} osOptions={osOptions} onClose={() => setEditingBaseline(null)} onSaved={() => { setEditingBaseline(null); setBaselineVersion((current) => current + 1); onNotice(t('Línea base Netskope guardada y auditada.')); }} /> : null}
  </>;
}
