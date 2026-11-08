import { useMemo } from 'react';
import type { AccessDomain, AccessPermission } from '../lib/access-control-api';
import { PER_USER_DATA, capabilityLabel, isReadCapability, isVisibleCapability } from '../lib/access-labels';
import './access-capabilities.css';
import { t } from '../i18n/index.ts';

type Props = { codes: string[]; permissions: AccessPermission[]; domains: AccessDomain[]; label?: string };

type Area = { domain: string; name: string; read: string[]; write: string[] };

/** ACCESS-UI-001: plain text, one entry per area — what it lets you see and what it lets you change.
 *  Menu gates (domain:*) and legacy codes are not capabilities; codes stay in the title and in AccessCodes. */
export function AccessCapabilities({ codes, permissions, domains, label = 'Accesos' }: Props) {
  const byCode = useMemo(() => new Map(permissions.map((permission) => [permission.permission_code, permission])), [permissions]);
  const areas = useMemo(() => {
    const rows = new Map<string, Area>();
    for (const code of [...new Set(codes)].filter(isVisibleCapability).sort()) {
      const permission = byCode.get(code);
      const domain = permission?.domain_code || 'otros';
      const area = rows.get(domain) || { domain, name: domains.find((item) => item.domain_code === domain)?.display_name || domain, read: [], write: [] };
      (isReadCapability(code, permission) ? area.read : area.write).push(code);
      rows.set(domain, area);
    }
    const order = (domain: string) => domains.find((item) => item.domain_code === domain)?.sort_order ?? 999;
    return [...rows.values()].sort((a, b) => order(a.domain) - order(b.domain));
  }, [codes, byCode, domains]);
  const names = (items: string[]) => items.map((code, index) => <span key={code} title={code}>{index ? ', ' : ''}{capabilityLabel(code, byCode.get(code))}{PER_USER_DATA.has(code) ? t(' (por usuario)') : ''}</span>);
  if (!areas.length) return <p className="access-none">{t('Sin accesos.')}</p>;
  return <dl className="access-areas" aria-label={label}>{areas.map((area) => <div key={area.domain}>
    <dt>{area.name}</dt>
    {area.read.length ? <dd><em>{t('Ver')}</em> {names(area.read)}</dd> : null}
    {area.write.length ? <dd><em>{t('Operar')}</em> {names(area.write)}</dd> : null}
  </div>)}</dl>;
}

/** Before saving: what the change adds and removes, in the same short names. */
export function AccessChanges({ before, after, permissions }: { before: string[]; after: string[]; permissions: AccessPermission[]; domains?: AccessDomain[] }) {
  const byCode = new Map(permissions.map((permission) => [permission.permission_code, permission]));
  const added = after.filter((code) => !before.includes(code) && isVisibleCapability(code));
  const removed = before.filter((code) => !after.includes(code) && isVisibleCapability(code));
  const names = (codes: string[]) => codes.map((code) => capabilityLabel(code, byCode.get(code))).join(', ');
  return <div className="access-changes" aria-label={t('Cambios de acceso')}>
    {added.length ? <p><strong>{t('Agrega')}</strong> {names(added)}</p> : null}
    {removed.length ? <p><strong>{t('Quita')}</strong> {names(removed)}</p> : null}
    {!added.length && !removed.length ? <p>{t('El acceso efectivo no cambia.')}</p> : null}
  </div>;
}

/** The role's own codes, for whoever needs them. */
export function AccessCodes({ codes }: { codes: string[] }) {
  return <details className="access-codes"><summary>{t('Códigos técnicos')}</summary><p>{[...codes].sort().join(' · ')}</p></details>;
}
