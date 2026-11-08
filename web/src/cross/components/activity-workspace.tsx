import './activity-workspace.css';
import { useState } from 'react';
import { ActivityView } from './activity-view';
import { OperationalErrorsView } from './operational-errors-view';
import { SyncRunsView } from './sync-runs-view';
import { SyncScheduleView } from './sync-schedule-view';
import { OperationalLogsView } from './operational-logs-view';
import { t } from '../i18n/index.ts';

export function ActivityWorkspace({ permissions, onUnauthorized }: { permissions: string[]; onUnauthorized?: () => void }) {
  const [section, setSection] = useState<'activity' | 'runs' | 'schedule' | 'logs' | 'errors'>('activity');
  return <section className="activity-workspace">
    <div className="workspace-subnav workspace-subnav-nested" role="tablist" aria-label={t('Actividad administrativa')}>
      <button type="button" role="tab" aria-selected={section === 'activity'} className={section === 'activity' ? 'active' : ''} onClick={() => setSection('activity')}><strong>{t('Actividad')}</strong></button>
      <button type="button" role="tab" aria-selected={section === 'runs'} className={section === 'runs' ? 'active' : ''} onClick={() => setSection('runs')}><strong>{t('Sincronizaciones')}</strong></button>
      <button type="button" role="tab" aria-selected={section === 'schedule'} className={section === 'schedule' ? 'active' : ''} onClick={() => setSection('schedule')}><strong>{t('Agenda')}</strong></button>
      <button type="button" role="tab" aria-selected={section === 'logs'} className={section === 'logs' ? 'active' : ''} onClick={() => setSection('logs')}><strong>{t('Logs operativos')}</strong></button>
      <button type="button" role="tab" aria-selected={section === 'errors'} className={section === 'errors' ? 'active' : ''} onClick={() => setSection('errors')}><strong>{t('Errores del sistema')}</strong></button>
    </div>
    {section === 'activity' ? <ActivityView canExport={permissions.includes('inventory:export')} onUnauthorized={onUnauthorized} /> : section === 'runs' ? <SyncRunsView onUnauthorized={onUnauthorized} /> : section === 'schedule' ? <SyncScheduleView permissions={permissions} onUnauthorized={onUnauthorized} /> : section === 'logs' ? <OperationalLogsView onUnauthorized={onUnauthorized} /> : <OperationalErrorsView onUnauthorized={onUnauthorized} />}
  </section>;
}
