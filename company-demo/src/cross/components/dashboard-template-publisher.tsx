import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { listAccessRoles } from '../lib/access-control-api';
import { CompactSelect } from './compact-select';
import { ConfirmDialog } from './confirm-dialog';
import './dashboard-widget.css';

export function DashboardTemplatePublisher({ disabled, blockCount, onPublish }: {
  disabled: boolean; blockCount: number; onPublish: (roleCode: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [roleCode, setRoleCode] = useState('');
  const roles = useQuery({ queryKey: ['access', 'roles', 'dashboard-publisher'], enabled: open, queryFn: listAccessRoles });
  const options = (roles.data?.rows ?? []).filter((role) => role.lifecycle_status === 'active').map((role) => ({ value: role.role_code, label: role.display_name }));
  const selected = roleCode || options[0]?.value || '';
  const confirm = async () => { if (selected && await onPublish(selected)) setOpen(false); };
  return <>
    <button type="button" className="button subtle" disabled={disabled} onClick={() => setOpen(true)}><Send size={14} aria-hidden="true" /> Publicar para un rol</button>
    {open ? <ConfirmDialog icon={<Send size={18} />} titleId="publish-dashboard-title" title="Publicar vista de equipo" descriptionId="publish-dashboard-description" description={<span>Esta vista de <strong>{blockCount} bloques</strong> quedará como una nueva versión para el rol elegido. Las vistas personales existentes no se modifican.<span className="dashboard-template-role"><CompactSelect value={selected} options={options} onChange={setRoleCode} ariaLabel="Rol que recibirá la vista" disabled={roles.isLoading} /></span></span>} onClose={() => setOpen(false)} confirmLabel="Publicar nueva versión" confirmBusyLabel="Publicando…" confirmBusy={disabled} confirmDisabled={!selected} confirmTone="primary" onConfirm={() => void confirm()} /> : null}
  </>;
}
