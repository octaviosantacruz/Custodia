import { ChevronDown, Settings2 } from 'lucide-react';
import { CatalogAdmin } from './catalog-admin';
import { SafeTable, type SafeTableProps } from './safe-table';
import { Metric } from './dashboard';
import { StatusGlossary } from './status-glossary';
import { OverflowActions } from './overflow-actions';
import { formatNumber, resultCountLabel } from '../lib/format';
import type { AccountPlatformCoverage, AccountPlatformStatus, Catalogs, SafeHealthFilter } from '../types/safe';
import type { Summary } from '../types/dashboard';


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
};

export function SafesWorkspace({
  catalogs, catalogManagerOpen, onOpenCatalogManager, onCloseCatalogManager,
  onCatalogChanged, onNotice, onError, tableProps, canManageCatalogs, summary, healthFilter, onHealthChange, accountPlatformCoverage,
}: SafesWorkspaceProps) {
  const health = summary?.safe_health;
  const setHealth = (value: SafeHealthFilter) => onHealthChange(healthFilter === value ? '' : value);
  const setPlatformStatus = (value: AccountPlatformStatus) => tableProps.onAccountPlatformChange(value);
  return <>
    <section className="database-toolbar">
      <div><h2>Inventario de Safes</h2><span className="database-caption">Revisá accesos, cuentas y asignaciones desde una sola tabla.</span></div>
      <div className="database-toolbar-actions">
        {canManageCatalogs && <OverflowActions
          ariaLabel="Acciones del inventario de Safes"
          actions={[{
            id: 'catalogs',
            label: 'Administrar catálogos',
            icon: <Settings2 size={14} />,
            onSelect: onOpenCatalogManager,
          }]}
        />}
        <span className="database-toolbar-count">{resultCountLabel(tableProps.total)}</span>
      </div>
    </section>
    <section className="inventory-insights" aria-label="Indicadores rápidos">
      <details>
        <summary><span className="inventory-insights-title">Indicadores rápidos</span><span className="inventory-insights-summary">{health ? `${formatNumber(health.denominator)} Safes activos · ${formatNumber(accountPlatformCoverage.accounts_active)} cuentas activas` : 'Señales técnicas y cobertura de cuentas'}</span><ChevronDown size={15} /></summary>
        <div className="inventory-insights-body">
          {health && <section className="safe-health-section" aria-label="Safe Health">
            <div className="section-heading"><div><h2 className="heading-with-help">Safe Health <StatusGlossary scope="safe_health" compact /></h2><span className="database-caption">Seleccioná una señal para llevarla a la tabla.</span></div><span className="section-heading-note">Inventario actual</span></div>
            <div className="metrics compact safe-health-metrics">
              <button type="button" className="metric-button" onClick={() => setHealth('missing_cpm')} aria-pressed={healthFilter === 'missing_cpm'}><Metric label="Sin CPM" value={health.missing_cpm} detail="CPM no informado" tone={health.missing_cpm ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setHealth('no_accounts')} aria-pressed={healthFilter === 'no_accounts'}><Metric label="Sin cuentas" value={health.no_accounts} detail="sin cuentas activas" tone={health.no_accounts ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setHealth('retention_unconfigured')} aria-pressed={healthFilter === 'retention_unconfigured'}><Metric label="Sin retención/purga" value={health.retention_unconfigured} detail="política no configurada" tone={health.retention_unconfigured ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setHealth('manage_safe_concentration')} aria-pressed={healthFilter === 'manage_safe_concentration'}><Metric label="2+ Manage Safe" value={health.manage_safe_concentration} detail="principales registrados" /></button>
            </div>
          </section>}
          <section className="account-platform-section" aria-label="Cobertura de cuentas y plataformas">
            <div className="section-heading"><div><h2>Cuentas y plataformas</h2><span className="database-caption">Relaciones observadas en la última sincronización PAM.</span></div><span className="section-heading-note">Sin credenciales</span></div>
            <div className="metrics compact safe-health-metrics">
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('')}><Metric label="Cuentas activas" value={accountPlatformCoverage.accounts_active} detail="inventario vigente" /></button>
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('with_platform')}><Metric label="Con plataforma" value={accountPlatformCoverage.accounts_with_platform} detail={`${formatNumber(accountPlatformCoverage.platforms_observed)} plataformas observadas`} tone="green" /></button>
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('without_platform')}><Metric label="Sin plataforma informada" value={accountPlatformCoverage.accounts_without_platform} detail="requiere revisión de fuente" tone={accountPlatformCoverage.accounts_without_platform ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => setPlatformStatus('partial_platform')}><Metric label="Relación parcial" value={accountPlatformCoverage.accounts_with_partial_platform} detail="ID o nombre incompleto" tone={accountPlatformCoverage.accounts_with_partial_platform ? 'amber' : 'green'} /></button>
              <button type="button" className="metric-button" onClick={() => { setPlatformStatus(''); onHealthChange('no_accounts'); }}><Metric label="Safes sin cuentas" value={accountPlatformCoverage.safes_without_accounts} detail="no implica incumplimiento" /></button>
            </div>
          </section>
        </div>
      </details>
    </section>
    {catalogManagerOpen && <CatalogAdmin catalogs={catalogs} onChanged={onCatalogChanged} onNotice={onNotice} onError={onError} onClose={onCloseCatalogManager} />}
    <section className="database-content"><SafeTable {...tableProps} /></section>
  </>;
}
