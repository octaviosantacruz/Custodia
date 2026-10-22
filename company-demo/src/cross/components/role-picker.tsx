import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { AccessRole } from '../lib/access-control-api';
import './role-picker.css';

export const domainLabels: Record<string, string> = { custom: 'Roles custom', platform: 'Plataforma', pam: 'CyberArk', dlp: 'Netskope', dspm: 'BigID' };
export const formatPermissionCount = (count: number) => count === 1 ? '1 permiso' : `${count} permisos`;

type RolePickerProps = { value: string; options: AccessRole[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean; placeholder?: string };

export function RolePicker({ value, options, onChange, ariaLabel, disabled = false, placeholder = 'Asignar rol' }: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((role) => role.role_code === value);
  const visibleOptions = useMemo(() => options.filter((role) => `${role.display_name} ${role.role_code} ${domainLabels[role.domain_code || 'custom'] || role.domain_code || 'custom'}`.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const groupedOptions = useMemo(() => visibleOptions.reduce<Record<string, AccessRole[]>>((groups, role) => { (groups[role.domain_code || 'custom'] ||= []).push(role); return groups; }, {}), [visibleOptions]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', closeOnOutside);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
    };
  }, [open]);

  const choose = (roleCode: string) => { setOpen(false); setQuery(''); rootRef.current?.querySelector<HTMLButtonElement>('.role-picker-trigger')?.focus(); onChange(roleCode); };
  return <div className="role-picker" ref={rootRef} onKeyDownCapture={(event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery('');
      rootRef.current?.querySelector<HTMLButtonElement>('.role-picker-trigger')?.focus();
    }
  }}>
    <button className={`role-picker-trigger ${open ? 'open' : ''}`} type="button" aria-label={ariaLabel} title={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}><span className="role-picker-current"><span className={`role-picker-dot ${selected?.lifecycle_status || 'active'}`} />{selected?.display_name || value || placeholder}</span><ChevronDown size={14} /></button>
    {open && <div className="role-picker-menu"><label className="role-picker-search"><Search size={14} /><span className="sr-only">Buscar roles</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar rol o producto" /></label><div className="role-picker-options" role="listbox" aria-label={ariaLabel}>{Object.entries(groupedOptions).map(([domain, domainRoles]) => <div className="role-picker-group" role="group" aria-label={domainLabels[domain] || domain} key={domain}><span className="role-picker-group-label">{domainLabels[domain] || domain}</span>{domainRoles.map((role) => <button className={`role-picker-option ${role.role_code === value ? 'selected' : ''}`} type="button" role="option" aria-selected={role.role_code === value} key={role.role_code} onClick={() => choose(role.role_code)}><span><strong>{role.display_name}</strong><small>{role.permission_codes.length ? formatPermissionCount(role.permission_codes.length) : 'Rol base'}{role.lifecycle_status === 'planned' ? ' · Preparado' : ''}</small></span>{role.role_code === value && <Check size={14} />}</button>)}</div>)}{!visibleOptions.length ? <span className="role-picker-empty">No hay roles que coincidan.</span> : null}</div></div>}
  </div>;
}
