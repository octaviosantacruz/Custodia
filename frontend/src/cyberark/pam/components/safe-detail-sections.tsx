import type { Account, Member, SafeDetail } from '../types/safe';
import { formatNumber } from '../../../cross/lib/format';
import { StateBlock } from '../../../cross/components/state-block';
import './safe-detail-drawer.css';

function accountTypeTone(key: string): string {
  const value = key.toLowerCase();
  if (value.includes('no nominal')) return 'nonominal';
  if (value.includes('interno') || value.includes('cyberark managed')) return 'cyberark';
  if (value.includes('nominal')) return 'nominal';
  if (value.includes('cyberark')) return 'cyberark';
  return 'other';
}

function Value({ value, fallback = 'Sin dato' }: { value: string | number | null | undefined; fallback?: string }) {
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
  const olacLabel = safe.olac_enabled === true ? 'Activo' : safe.olac_enabled === false ? 'Desactivado' : 'Sin dato';
  const retentionLabel = [
    safe.number_of_versions_retention !== null && safe.number_of_versions_retention !== undefined ? `${safe.number_of_versions_retention} versiones` : null,
    safe.number_of_days_retention !== null && safe.number_of_days_retention !== undefined ? `${safe.number_of_days_retention} días` : null,
  ].filter(Boolean).join(' · ') || 'Sin límites configurados';
  return <>
    <section className="detail-section">
      <h3>Referencia técnica</h3>
      <dl className="detail-facts">
        <div><dt>URL ID CyberArk</dt><Value value={safe.safe_url_id} /></div>
        <div><dt>Ubicación</dt><Value value={safe.location} fallback="Sin ubicación" /></div>
        <div><dt>Creado por</dt><Value value={safe.creator_name} /></div>
        <div><dt>CPM</dt><Value value={safeCpmValue(safe.managing_cpm)} fallback="CPM no disponible" /></div>
        <div title="Object Level Access Control. Se muestra como referencia técnica y no implica un incumplimiento sin una política definida."><dt>OLAC (referencia)</dt><Value value={olacLabel} fallback="Sin dato" /></div>
        <div><dt>Retención</dt><Value value={retentionLabel} /></div>
        <div><dt>Purga automática</dt><Value value={safe.auto_purge_enabled === true ? 'Activa' : safe.auto_purge_enabled === false ? 'Desactivada' : 'Sin dato'} /></div>
      </dl>
    </section>
    <section className="detail-section">
      <h3>Tipo de cuenta <span>{formatNumber(safe.account_count)}</span></h3>
      <div className="detail-account-types">
        {accountTypes.length
          ? accountTypes.map(([key]) => <span className={`account-type-chip ${accountTypeTone(key)}`} key={key}>{key}</span>)
          : <span className="muted">Sin inventario histórico</span>}
      </div>
    </section>
  </>;
}

export function SafeAccountList({ accounts, total }: { accounts: Account[]; total?: number }) {
  return <section className="detail-section accounts-section">
    <div className="section-heading"><h3>Cuentas actuales <span>{formatNumber(total ?? accounts.length)}</span></h3><p className="detail-summary-copy">Inventario sin credenciales ni secretos.</p></div>
    {accounts.length ? <div className="detail-account-list">{accounts.map((account) => <article className="detail-account-row" key={account.account_id}>
      <div><strong>{account.account_name}</strong><span>{account.user_name || 'Sin usuario'} · {account.address || 'Sin dirección'}</span></div>
      <span className="account-platform">{account.platform_name || account.platform_id || 'Sin plataforma'}</span>
    </article>)}</div> : <StateBlock variant="empty" title="Sin cuentas activas registradas" />}
  </section>;
}

export function SafeMemberList({ members }: { members: Member[] }) {
  return <details className="detail-section members-section" open>
    <summary><h3>Miembros actuales <span>{formatNumber(members.length)}</span></h3></summary>
    <div className="member-list"><table className="member-table"><thead><tr><th>Miembro</th><th>Tipo</th><th>Acceso</th></tr></thead><tbody>
      {members.length ? members.map((member, index) => <tr key={`${member.member_id}-${member.member_name}-${index}`}><td title={member.member_name}>{member.member_name}</td><td>{member.member_type}</td><td>{member.is_read_only ? 'Solo lectura' : 'Acceso'}</td></tr>) : <tr><td colSpan={3} className="state-cell"><StateBlock variant="empty" title="Sin miembros" hint="Esta Safe no tiene relaciones de permiso registradas." /></td></tr>}
    </tbody></table></div>
  </details>;
}
