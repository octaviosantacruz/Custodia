import { useRef, useState } from 'react';
import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import { NetskopeOfficeExperience } from './netskope-office-experience';
import { NetskopeOfficeTimeline } from './netskope-office-timeline';
import { NetskopeUserDrawer, type NetskopeUserSelection } from './netskope-user-drawer';
import { t } from '../../../cross/i18n/index.ts';

type Props = { refreshKey: number; authChecked: boolean; authenticated: boolean; onUnauthorized: () => void };
type Tab = 'office' | 'timeline';
const TABS = [['office', 'Oficina, por semana'], ['timeline', 'Evolución diaria']] as const;

/* NSK-EXP-OFFICE-001/002: strict workspace (netskope:uba_read) for the performance (ADEM) measured by Custodia:
   the weekly office summary and the daily timeline by company and person. Riesgo answers only risk; each person
   opens the same ficha as Riesgo, with their last 7 days. */
export function NetskopeOfficeWorkspace({ refreshKey, authChecked, authenticated, onUnauthorized }: Props) {
  const [selected, setSelected] = useState<NetskopeUserSelection | null>(null);
  const [tab, setTab] = useState<Tab>('office');
  const fallbackFocusRef = useRef<HTMLInputElement>(null);
  const enabled = authChecked && authenticated;
  const pick = (person: { email: string; name: string | null }) => setSelected({ userId: null, email: person.email, name: person.name || person.email });
  return <section className="netskope-workspace" aria-label={t('Vista de rendimiento de Netskope')}>
    <nav className="workspace-subnav workspace-subnav-nested" role="tablist" aria-label={t('Secciones de Rendimiento')} onKeyDown={handleTablistKeyDown}>
      {TABS.map(([id, label]) => <button
        key={id} type="button" role="tab" id={`nsk-office-tab-${id}`} aria-controls={`nsk-office-panel-${id}`}
        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}
      ><strong>{label}</strong></button>)}
    </nav>
    {TABS.map(([id]) => <div key={id} role="tabpanel" id={`nsk-office-panel-${id}`} aria-labelledby={`nsk-office-tab-${id}`} hidden={tab !== id}>
      {tab !== id ? null : id === 'office'
        ? <NetskopeOfficeExperience enabled={enabled} refreshKey={refreshKey} onUnauthorized={onUnauthorized} onPick={pick} />
        : <NetskopeOfficeTimeline enabled={enabled} refreshKey={refreshKey} onUnauthorized={onUnauthorized} onPick={pick} />}
    </div>)}
    {selected && enabled ? <NetskopeUserDrawer key={selected.email} user={selected} refreshKey={refreshKey} canReadUba
      onUnauthorized={onUnauthorized} onClose={() => setSelected(null)} fallbackFocusRef={fallbackFocusRef} /> : null}
  </section>;
}
