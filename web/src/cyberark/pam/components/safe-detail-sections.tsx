import type { Account, Member, SafeDetail } from '../types/safe';
import { formatNumber } from '../../../cross/lib/format';
import { StateBlock } from '../../../cross/components/state-block';
import './safe-detail-drawer.css';
import { t } from '../../../cross/i18n/index.ts';

function accountTypeTone(key: string): string {
  const value = key.toLowerCase();
  if (value.includes('no nominal')) return 'nonominal';
  if (value.includes('interno') || value.includes('cyberark managed')) return 'cyberark';
  if (value.includes('nominal')) return 'nominal';
  if (value.includes('cyberark')) return 'cyberark';
  return 'other';
}

function Value({ value, fallback = t('Sin dato') }: { value: string | number | null | undefined; fallback?: string }) {
  if (value === null || value === undefined || value === '' || value === '\\') {
    return <dd className="muted">{fallback}</dd>;
  }
  return <dd>{String(value)}</dd>;
}

function safeCpmValue(value: string | null): string | null {
  if (!value || value.includes(',')) return null;
  return value.trim() || null;
}

export function SafeSummary({ safe }: { safe: SafeDetail }) {
  const accountTypes = Object.entries(safe.account_type_counts || {});
  const olacLabel = safe.olac_enabled === true ? t('Activo') : safe.olac_enabled === false ? t('Desactivado') : t('Sin dato');
  const retentionLabel = [
    safe.number_of_versions_retention !== null && safe.number_of_versions_retention !== undefined ? `${safe.number_of_versions_retention} versiones` : null,
    safe.number_of_days_retention !== null && safe.number_of_days_retention !== undefined ? t('{number_of_days_retention} días', { number_of_days_retention: safe.number_of_days_retention }) : null,
  ].filter(Boolean).join(' · ') || t('Sin límites configurados');
  return <>
    <section className="detail-section">
      <h3>{t('Referencia técnica')}</h3>
      <dl className="detail-facts">
        <div><dt>{t('URL ID CyberArk')}</dt><Value value={safe.safe_url_id} /></div>
        <div><dt>{t('Ubicación')}</dt><Value value={safe.location} fallback="Sin ubicación" /></div>
        <div><dt>{t('Creado por')}</dt><Value value={safe.creator_name} /></div>
        <div><dt>CPM</dt><Value value={safeCpmValue(safe.managing_cpm)} fallback="CPM no disponible" /></div>
        <div title={t('Object Level Access Control. Se muestra como referencia técnica y no implica un incumplimiento sin una política definida.')}><dt>OLAC (referencia)</dt><Value value={olacLabel} fallback="Sin dato" /></div>
        <div><dt>{t('Retención')}</dt><Value value={retentionLabel} /></div>
        <div><dt>{t('Purga automática')}</dt><Value value={safe.auto_purge_enabled === true ? 'Activa' : safe.auto_purge_enabled === false ? t('Desactivada') : t('Sin dato')} /></div>
      </dl>
    </section>
    <section className="detail-section">
      <h3>{t('Tipo de cuenta')} <span>{formatNumber(safe.account_count)}</span></h3>
      <div className="detail-account-types">
        {accountTypes.length
          ? accountTypes.map(([key]) => <span className={`account-type-chip ${accountTypeTone(key)}`} key={key}>{key}</span>)
          : <span className="muted">{t('Sin inventario histórico')}</span>}
      </div>
    </section>
  </>;
}

export function SafeAccountList({ accounts, total }: { accounts: Account[]; total?: number }) {
  return <section className="detail-section accounts-section">
    <div className="section-heading"><h3>{t('Cuentas actuales')} <span>{formatNumber(total ?? accounts.length)}</span></h3><p className="detail-summary-copy">{t('Inventario sin credenciales ni secretos.')}</p></div>
    {accounts.length ? <div className="detail-account-list">{accounts.map((account) => <article className="detail-account-row" key={account.account_id}>
      <div><strong>{account.account_name}</strong><span>{account.user_name || t('Sin usuario')} · {account.address || t('Sin dirección')}</span></div>
      <span className="account-platform">{account.platform_name || account.platform_id || t('Sin plataforma')}</span>
    </article>)}</div> : <StateBlock variant="empty" title={t('Sin cuentas activas registradas')} />}
  </section>;
}

export function SafeMemberList({ members }: { members: Member[] }) {
  return <details className="detail-section members-section" open>
    <summary><h3>{t('Miembros actuales')} <span>{formatNumber(members.length)}</span></h3></summary>
    <div className="member-list"><table className="member-table"><thead><tr><th>{t('Miembro')}</th><th>{t('Tipo')}</th><th>{t('Acceso')}</th></tr></thead><tbody>
      {members.length ? members.map((member, index) => <tr key={`${member.member_id}-${member.member_name}-${index}`}><td title={member.member_name}>{member.member_name}</td><td>{member.member_type}</td><td>{member.is_read_only ? t('Solo lectura') : t('Acceso')}</td></tr>) : <tr><td colSpan={3} className="state-cell"><StateBlock variant="empty" title={t('Sin miembros')} hint="Esta Safe no tiene relaciones de permiso registradas." /></td></tr>}
    </tbody></table></div>
  </details>;
}
