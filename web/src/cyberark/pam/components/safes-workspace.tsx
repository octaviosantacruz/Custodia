import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Settings2 } from 'lucide-react';
import { CatalogAdmin } from './catalog-admin';
import { RetiredSafesList } from './retired-safes-list';
import { SafeTable, type SafeTableProps } from './safe-table';
import { Metric } from '../../../cross/components/dashboard';
import { StatusGlossary } from '../../../cross/components/status-glossary';
import { HelpHint } from '../../../cross/components/help-hint';
import { StateBlock } from '../../../cross/components/state-block';
import { OverflowActions } from './overflow-actions';
import { usePamRefreshKey } from '../../shared/refresh-context';
import { fetchRetiredSafes } from '../lib/retired-safes-api';
import { formatNumber, resultCountLabel } from '../../../cross/lib/format';
import { handleTablistKeyDown } from '../../../cross/lib/tablist-keyboard';
import type { AccountManagementSummary, AccountPlatformCoverage, AccountPlatformStatus, Catalogs, SafeHealthFilter } from '../types/safe';
import type { Summary } from '../types/dashboard';
import './inventory-insights.css';
import './safe-table.css';
import { t } from '../../../cross/i18n/index.ts';


type SafesWorkspaceProps = {
  catalogs: Catalogs;
  catalogManagerOpen: boolean;
  onOpenCatalogManager: () => void;
  onCloseCatalogManager: () => void;
  onCatalogChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  tableProps: SafeTableProps;
  canManageCatalogs: boolean;
  summary: Summary | null;
  healthFilter: SafeHealthFilter;
  onHealthChange: (value: SafeHealthFilter) => void;
  accountPlatformCoverage: AccountPlatformCoverage;
  accountManagementSummary: AccountManagementSummary | null;
  accountManagementSummaryLoading: boolean;
  accountManagementSummaryError: boolean;
  /** Notified only when the visible scope really changes. The router uses it
   *  to close the Safe detail drawer before the retired list takes over. */
  onScopeChange?: (scope: 'active' | 'retired') => void;
};

export function SafesWorkspace({
  catalogs, catalogManagerOpen, onOpenCatalogManager, onCloseCatalogManager,
  onCatalogChanged, onNotice, onError, tableProps, canManageCatalogs, summary, healthFilter, onHealthChange, accountPlatformCoverage, accountManagementSummary, accountManagementSummaryLoading, accountManagementSummaryError, onScopeChange,
}: SafesWorkspaceProps) {
  const health = summary?.safe_health;
  const setHealth = (value: SafeHealthFilter) => onHealthChange(healthFilter === value ? '' : value);
  const setPlatformStatus = (value: AccountPlatformStatus) => tableProps.onAccountPlatformChange(value);
  /* Scope switcher: "Vigentes" is the default and keeps the current inventory
     mounted so switching away and back preserves filters, selection and the
     open detail drawer state. */
  const [scope, setScope] = useState<'active' | 'retired'>('active');
  const changeScope = (next: 'active' | 'retired') => {
    if (next === scope) return;
    setScope(next);
    onScopeChange?.(next);
  };
  /* Count only (limit=1); shares the query key prefix with the list so the
     list's own refetch invalidates it on every sync refresh. */
  const refreshKey = usePamRefreshKey();
  const retiredCount = useQuery({
    queryKey: ['pam', 'retired-safes', 'count', refreshKey],
    queryFn: ({ signal }) => fetchRetiredSafes(1, { signal }),
    staleTime: 60_000,
  });
  const retiredTotal = retiredCount.data?.total ?? 0;
  return <>
    <section className="database-toolbar">
      <div className="database-toolbar-actions">
        <div className="scope-segmented" role="tablist" aria-label={t('Vigencia de Safes')} onKeyDown={handleTablistKeyDown}>
          <button type="button" role="tab" aria-selected={scope === 'active'} tabIndex={scope === 'active' ? 0 : -1} className={scope === 'active' ? 'active' : ''} onClick={() => changeScope('active')}>{t('Vigentes')}</button>
          <button type="button" role="tab" aria-selected={scope === 'retired'} tabIndex={scope === 'retired' ? 0 : -1} className={scope === 'retired' ? 'active' : ''} onClick={() => changeScope('retired')}>{t('Retiradas')}{retiredTotal ? <span className="scope-segmented-count">{formatNumber(retiredTotal)}</span> : null}</button>
        </div>
        {scope === 'active' && canManageCatalogs && <OverflowActions
          ariaLabel={t('Acciones del inventario de Safes')}
          actions={[{
            id: 'catalogs',
            label: t('Administrar catálogos'),
            icon: <Settings2 size={14} />,
            onSelect: onOpenCatalogManager,
          }]}
        />}
        {scope === 'active' && <span className="database-toolbar-count">{resultCountLabel(tableProps.total)}</span>}
      </div>
    </section>
    <div className={scope === 'retired' ? 'is-hidden' : undefined}>
    <section className="inventory-insights" aria-label={t('Indicadores rápidos')}>
      <details>
        <summary><span className="inventory-insights-title">{t('Indicadores rápidos')}</span><span className="inventory-insights-summary">{health ? t('{safes} Safes activos · {accounts} cuentas activas', { safes: formatNumber(health.denominator), accounts: formatNumber(accountPlatformCoverage.accounts_active) }) : t('Señales técnicas y cobertura de cuentas')}</span><ChevronDown size={15} /></summary>
         <div className="inventory-insights-body">
          {health && <section className="safe-health-section" aria-label={t('Safe Health')}>
            <div className="section-heading"><div><h2 className="heading-with-help">{t('Safe Health')} <StatusGlossary scope="safe_health" compact /></h2><span className="database-caption">{t('Inventario actual')}</span><HelpHint label={t('Cómo usar Safe Health')}><p>Seleccioná una señal para llevarla a la tabla. Los indicadores describen datos observados; no infieren obligaciones de política que no estén informadas.</p></HelpHint></div></div>
            <div className="metrics compact safe-health-metrics">
              <button type="button" className="metric-button" onClick={() => setHealth('missing_cpm')} aria-pressed={healthFilter === 'missing_cpm'}><Metric label={t('Sin CPM')} value={health.missing_cpm} detail="CPM no informado" tone={health.missing_cpm ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setHealth('no_accounts')} aria-pressed={healthFilter === 'no_accounts'}><Metric label={t('Sin cuentas')} value={health.no_accounts} detail="sin cuentas activas" tone={health.no_accounts ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setHealth('retention_unconfigured')} aria-pressed={healthFilter === 'retention_unconfigured'}><Metric label={t('Sin retención/purga')} value={health.retention_unconfigured} detail="política no configurada" tone={health.retention_unconfigured ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setHealth('manage_safe_concentration')} aria-pressed={healthFilter === 'manage_safe_concentration'}><Metric label={t('2+ Manage Safe')} value={health.manage_safe_concentration} detail="principales registrados" /></button>
            </div>
          </section>}
          <section className="account-platform-section" aria-label={t('Cobertura de cuentas y plataformas')}>
             <div className="section-heading"><div><h2>{t('Cuentas y plataformas')}</h2><HelpHint label={t('Cobertura de cuentas y plataformas')}><p>{t('Relaciones observadas en la última sincronización PAM. Esta vista excluye credenciales y no presenta estos valores como evidencia de rotación.')}</p></HelpHint></div></div>
            <div className="metrics compact safe-health-metrics">
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('')}><Metric label={t('Cuentas activas')} value={accountPlatformCoverage.accounts_active} detail="inventario vigente" /></button>
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('with_platform')}><Metric label={t('Con plataforma')} value={accountPlatformCoverage.accounts_with_platform} detail={`${formatNumber(accountPlatformCoverage.platforms_observed)} plataformas observadas`} tone="green" /></button>
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('without_platform')}><Metric label={t('Sin plataforma informada')} value={accountPlatformCoverage.accounts_without_platform} detail="requiere revisión de fuente" tone={accountPlatformCoverage.accounts_without_platform ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('partial_platform')}><Metric label={t('Relación parcial')} value={accountPlatformCoverage.accounts_with_partial_platform} detail="ID o nombre incompleto" tone={accountPlatformCoverage.accounts_with_partial_platform ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => { setPlatformStatus(''); onHealthChange('no_accounts'); }}><Metric label={t('Safes sin cuentas')} value={accountPlatformCoverage.safes_without_accounts} detail="no implica incumplimiento" /></button>
            </div>
            {accountManagementSummary && <>
              <div className="metrics compact safe-health-metrics">
                <Metric label={t('Gestión automática deshabilitada')} value={accountManagementSummary.automatic_disabled} detail={`de ${formatNumber(accountManagementSummary.accounts_active)} cuentas activas`} tone={accountManagementSummary.automatic_disabled ? 'amber' : 'green'} />
                <Metric label={t('Gestión automática activa')} value={accountManagementSummary.automatic_enabled} detail={t('cuentas activas')} tone="green" />
                <Metric label={t('Sin dato de gestión')} value={accountManagementSummary.management_unknown} detail={t('cuentas activas')} />
              </div>
              <p className="database-caption">Último cambio de secreto o alta: hasta 30 días {formatNumber(accountManagementSummary.changed_30d)} · 31–90 días {formatNumber(accountManagementSummary.changed_90d)} · 91–365 días {formatNumber(accountManagementSummary.changed_365d)} · más de 365 días {formatNumber(accountManagementSummary.changed_older)} · sin dato {formatNumber(accountManagementSummary.changed_unknown)}</p>
            </>}
            {accountManagementSummaryLoading && <StateBlock variant="loading" title={t('Cargando el resumen de gestión de cuentas...')} />}
            {accountManagementSummaryError && <StateBlock variant="error" title={t('No se pudo cargar el resumen de gestión')} hint="La cobertura de plataformas y las cuentas por Safe siguen disponibles." />}
             {accountManagementSummary && <HelpHint label={t('Interpretación de gestión de cuentas')}><p>Estado de gestión según CyberArk. El último cambio combina alta de la cuenta y cambio de secreto; no equivale a rotación. CyberArk no entrega fecha de verificación ni de reconciliación en este tenant.</p></HelpHint>}
          </section>
        </div>
      </details>
    </section>
    {catalogManagerOpen && <CatalogAdmin catalogs={catalogs} onChanged={onCatalogChanged} onNotice={onNotice} onError={onError} onClose={onCloseCatalogManager} />}
    <section className="database-content"><SafeTable {...tableProps} /></section>
    </div>
    {scope === 'retired' && <section className="database-content"><RetiredSafesList /></section>}
  </>;
}
