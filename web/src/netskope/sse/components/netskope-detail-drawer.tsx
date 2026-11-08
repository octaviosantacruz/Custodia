import { DateTime } from '../../../cross/components/date-time';
import { useState } from 'react';
import { Check, Copy, UserRound, X } from 'lucide-react';
import { Field } from '../../../cross/components/dashboard';
import { companyFromIdentity } from '../lib/netskope-company';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import type { NetskopeRow } from '../types/netskope';
import { NetskopeUserExperience } from './netskope-user-experience';
import { t } from '../../../cross/i18n/index.ts';

type Props = {
  row: NetskopeRow | null;
  onClose: () => void;
};

function text(row: NetskopeRow, key: string): string {
  const current = row.attributes[key];
  return current === null || current === undefined || current === '' ? 'Sin dato' : String(current);
}

function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button
    type="button"
    className="button subtle netskope-copy-id"
    aria-label={`Copiar identificador ${value}`}
    title={t('Copiar identificador')}
    onClick={() => {
      void navigator.clipboard?.writeText(value)
        .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })
        .catch(() => setCopied(false));
    }}
  >{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? t('Copiado') : t('Copiar')}</button>;
}

/* NSK-USR-001: the console's reading of accounts[] (a deleted account does not exist; enabled = one live active account). */
function accountStatusText(row: NetskopeRow): string {
  const status = row.attributes.account_status;
  const active = row.attributes.accounts_active;
  const inactive = row.attributes.accounts_inactive;
  if ((status !== 'enabled' && status !== 'disabled') || typeof active !== 'number' || typeof inactive !== 'number') return 'Sin dato';
  const provisioners = Array.isArray(row.attributes.provisioners) ? ` · origen ${row.attributes.provisioners.join(', ')}` : '';
  return `${status === 'enabled' ? t('Habilitado') : t('Deshabilitado')} · ${active} cuenta${active === 1 ? '' : 's'} activa${active === 1 ? '' : 's'}, ${inactive} inactiva${inactive === 1 ? '' : 's'}${provisioners}`;
}

/** Netskope user detail. Devices open inline in the inventory instead (NSK-INV-002). */
export function NetskopeDetailDrawer({ row, onClose }: Props) {
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ active: Boolean(row), onClose });

  if (!row) return null;

  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="netskope-drawer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label={t('Cerrar detalle Netskope')} onClick={onClose} />
    <aside className="detail-drawer netskope-detail-drawer">
      <div className="detail-title">
        <div className="detail-icon"><UserRound size={18} /></div>
        <div className="detail-heading">
          <p className="eyebrow">USUARIO</p>
          <h2 id="netskope-drawer-title">{row.display_name}</h2>
        </div>
        <button className="icon-button drawer-close" type="button" title={t('Cerrar')} aria-label={t('Cerrar')} onClick={onClose}><X size={16} /></button>
      </div>
      <section className="detail-section">
        <div className="detail-section-heading"><h3>{t('Identidad')}</h3></div>
        <div className="form-grid">
          <Field label={t('Nombre visible')}><span className="detail-value">{row.display_name}</span></Field>
          <Field label={t('Correo')}><span className="detail-value">{text(row, 'email')}</span></Field>
          <Field label={t('Empresa')}><span className="detail-value">{companyFromIdentity(text(row, 'email'))}</span></Field>
          <Field label={t('Estado de cuentas')}><span className="detail-value">{accountStatusText(row)}</span></Field>
          <Field label={t('Identificador')}><span className="detail-value mono">{row.source_id}</span><CopyIdButton value={row.source_id} /></Field>
          <Field label={t('Observado')}><span className="detail-value"><DateTime value={row.first_seen_at} /> → <DateTime value={row.last_seen_at} /></span></Field>
        </div>
      </section>
      <NetskopeUserExperience key={row.object_id} userId={row.object_id} />
    </aside>
  </div>;
}
