import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { WORK_STATUSES } from '../lib/connection-work';
import type { ConnectionDestinationValues, ConnectionInventoryRow, WorkStatus } from '../types/connection';
import { CompactSelect } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';
import { t } from '../i18n/index.ts';

type Props = {
  row: ConnectionInventoryRow | null;
  /** Alta from a list of observed addresses: the IP arrives filled in and nothing else is assumed. */
  initialIp?: string;
  environments: string[];
  responsibles: string[];
  busy: boolean;
  error: string;
  onSave: (values: ConnectionDestinationValues) => void;
  onClose: () => void;
};

const FLAG_OPTIONS = [{ value: '', label: t('Sin dato') }, { value: 'yes', label: t('Sí') }, { value: 'no', label: t('No') }];
const toFlag = (value: boolean | null) => value === true ? 'yes' : value === false ? 'no' : '';
const fromFlag = (value: string): boolean | null => value === 'yes' ? true : value === 'no' ? false : null;

/** Alta (`row` null) and edición of one destination; the key is IP + puerto. */
export function ConnectionDestinationDialog({ row, initialIp, environments, responsibles, busy, error, onSave, onClose }: Props) {
  const [instance, setInstance] = useState(row?.instance_name ?? '');
  const [environment, setEnvironment] = useState(row?.environment ?? '');
  const [ip, setIp] = useState(row?.private_ip ?? initialIp ?? '');
  const [port, setPort] = useState(row?.port ? String(row.port) : '');
  const [flags, setFlags] = useState({ ca_sia: toFlag(row?.ca_sia ?? null), ca_dba: toFlag(row?.ca_dba ?? null), zsp_implemented: toFlag(row?.zsp_implemented ?? null), access_available: toFlag(row?.access_available ?? null) });
  const [description, setDescription] = useState(row?.description ?? '');
  const [workStatus, setWorkStatus] = useState<WorkStatus>(row?.work_status ?? 'pending');
  const [responsible, setResponsible] = useState(row?.responsible ?? '');
  const [note, setNote] = useState(row?.note ?? '');
  const portNumber = port.trim() ? Number(port) : null;
  const portInvalid = portNumber !== null && (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535);
  const incomplete = !instance.trim() || !ip.trim() || portInvalid;

  const flagField = (field: keyof typeof flags, label: string) => <label className="destination-field">
    <span>{label}</span>
    <CompactSelect value={flags[field]} ariaLabel={label} disabled={busy} options={FLAG_OPTIONS} onChange={(value) => setFlags((current) => ({ ...current, [field]: value }))} />
  </label>;

  return <ConfirmDialog
    icon={row ? <Pencil size={18} aria-hidden /> : <Plus size={18} aria-hidden />} titleId="destination-dialog-title"
    title={row ? t('Editar destino') : t('Agregar destino')} descriptionId="destination-dialog-description"
    description={row ? <>{row.instance_name} · {row.private_ip}{row.port ? `:${row.port}` : ''}</> : t('La clave es IP y puerto.')}
    confirmTone="primary" confirmLabel="Guardar" confirmBusyLabel="Guardando…" confirmBusy={busy} confirmDisabled={incomplete}
    onConfirm={() => onSave({
      instance_name: instance.trim(), environment: environment.trim(), private_ip: ip.trim(), port: portNumber,
      ca_sia: fromFlag(flags.ca_sia), ca_dba: fromFlag(flags.ca_dba), zsp_implemented: fromFlag(flags.zsp_implemented),
      access_available: fromFlag(flags.access_available), description: description.trim(),
      work_status: workStatus, responsible: responsible.trim(), note: note.trim(),
    })}
    onClose={onClose} closeDisabled={busy} backdropClassName="connection-import-backdrop"
  >
    <div className="destination-form">
      <label className="destination-field destination-wide"><span>{t('Instancia')}</span><input className="destination-input" value={instance} maxLength={240} disabled={busy} onChange={(event) => setInstance(event.target.value)} /></label>
      <label className="destination-field"><span>IP</span><input className="destination-input mono" value={ip} maxLength={80} disabled={busy} onChange={(event) => setIp(event.target.value)} /></label>
      <label className="destination-field"><span>{t('Puerto')}</span><input className="destination-input mono" inputMode="numeric" value={port} placeholder={t('Sin puerto')} aria-invalid={portInvalid} disabled={busy} onChange={(event) => setPort(event.target.value)} /></label>
      <label className="destination-field destination-wide"><span>{t('Ambiente')}</span>
        <input className="destination-input" list="destination-environments" value={environment} maxLength={80} placeholder={t('Sin ambiente')} disabled={busy} onChange={(event) => setEnvironment(event.target.value)} />
        <datalist id="destination-environments">{environments.map((name) => <option key={name} value={name} />)}</datalist>
      </label>
      {flagField('ca_sia', 'Platform')}{flagField('ca_dba', 'DBA')}{flagField('zsp_implemented', 'ZSP')}{flagField('access_available', 'Acceso')}
      <label className="destination-field"><span>{t('Estado de trabajo')}</span><CompactSelect value={workStatus} ariaLabel={t('Estado de trabajo')} disabled={busy} options={WORK_STATUSES.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setWorkStatus(value as WorkStatus)} /></label>
      <label className="destination-field"><span>{t('Responsable')}</span>
        <input className="destination-input" list="destination-responsibles" value={responsible} maxLength={120} placeholder={t('Sin responsable')} disabled={busy} onChange={(event) => setResponsible(event.target.value)} />
        <datalist id="destination-responsibles">{responsibles.map((name) => <option key={name} value={name} />)}</datalist>
      </label>
      <label className="destination-field destination-wide"><span>{t('Nota')}</span><input className="destination-input" value={note} maxLength={1000} placeholder={t('Ventana, bloqueo, contacto…')} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
      <label className="destination-field destination-wide"><span>{t('Descripción')}</span><input className="destination-input" value={description} maxLength={1000} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label>
    </div>
    {portInvalid && <p className="connection-import-error" role="alert">{t('El puerto va de 1 a 65535.')}</p>}
    {error && <p className="connection-import-error" role="alert">{error}</p>}
    {row && <p className="muted destination-note">Un import posterior puede volver a pisar este cambio; la vista previa lo muestra antes.</p>}
  </ConfirmDialog>;
}
