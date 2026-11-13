import { Search } from 'lucide-react';
import { useState } from 'react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { IdentityChip, StatusBadge } from '../../../cross/components/semantic';
import { describeSiaGranteeLink, filterSiaGranteeLinks, summarizeSiaGranteeLinks } from '../lib/sia-grantee-links';
import { siaGranteeTarget } from '../lib/sia-grantee';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import type { SiaPolicyRow } from '../types/sia';
import { t } from '../../../cross/i18n/index.ts';

const PAGE_SIZE = 25;
const EMPTY_FILTERS = { text: '', status: '', source: '' } as const;

export function SiaGranteeDetail({
  policy,
  onNavigate,
}: {
  policy: SiaPolicyRow;
  onNavigate: (view: WorkspaceView, query?: string) => void;
}) {
  const links = policy.grantee_links || [];
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const summary = summarizeSiaGranteeLinks(links);
  const hasIdentity = summary.sources.some((item) => item.source === 'identity');
  const hasPam = summary.sources.some((item) => item.source === 'pam');
  const hasEmailLinks = hasIdentity || hasPam;
  const filteredLinks = filterSiaGranteeLinks(links, {
    text,
    status: status as '' | 'matched' | 'ambiguous' | 'unmatched',
    source: source as '' | 'identity' | 'pam',
  }).filter((link) => link.identity || link.pam);
  const visibleLinks = filteredLinks.slice(0, visibleCount);
  const remaining = filteredLinks.length - visibleLinks.length;
  const grantedCount = policy.attributes.granted_users.length
    + policy.attributes.granted_groups.length
    + policy.attributes.granted_roles.length;

  function updateText(value: string) {
    setText(value);
    setVisibleCount(PAGE_SIZE);
  }

  function updateStatus(value: string) {
    setStatus(value);
    setVisibleCount(PAGE_SIZE);
  }

  function updateSource(value: string) {
    setSource(value);
    setVisibleCount(PAGE_SIZE);
  }

  function clearFilters() {
    setText(EMPTY_FILTERS.text);
    setStatus(EMPTY_FILTERS.status);
    setSource(EMPTY_FILTERS.source);
    setVisibleCount(PAGE_SIZE);
  }

  return <section className="sia-grantee-detail" aria-label="Destinatarios">
    <h3 className="sia-recipient-heading">Destinatarios</h3>
    {hasEmailLinks ? <div className="sia-recipient-subsection sia-email-links-section">
      <h4>{t('Vínculos por correo exacto')}</h4>
      <div className="sia-link-summary">
        {summary.sources.map((item) => <p key={item.source}>
          <strong>{item.sourceLabel}:</strong> vinculados {item.matched} · ambiguos {item.ambiguous} · sin coincidencia {item.unmatched} de {summary.recipients} destinatarios
        </p>)}
        <span>Conteos de esta política; no son un KPI de cobertura.</span>
      </div>
      <div className={`sia-grantee-filters${hasIdentity && hasPam ? ' has-source-filter' : ''}`}>
        <label className="search-box"><Search size={16} aria-hidden="true" /><input placeholder={t('Valor del destinatario')}
          type="search"
          aria-label={t('Filtrar destinatarios por valor')}
          value={text}
          onChange={(event) => updateText(event.target.value)}
        /></label>
        <label>{t('Estado')}<CompactSelect
          ariaLabel={t('Filtrar destinatarios por estado')}
          value={status}
          onChange={updateStatus}
          options={[
            { value: '', label: 'Todos' },
            { value: 'matched', label: 'Vinculados' },
            { value: 'ambiguous', label: 'Ambiguos' },
            { value: 'unmatched', label: t('Sin coincidencia') },
          ]}
        /></label>
        {hasIdentity && hasPam ? <label>{t('Fuente')}<CompactSelect
          ariaLabel={t('Filtrar destinatarios por fuente')}
          value={source}
          onChange={updateSource}
          options={[
            { value: '', label: 'Todas' },
            { value: 'identity', label: 'Identity Administration' },
            { value: 'pam', label: 'PAM' },
          ]}
        /></label> : null}
      </div>
      <p className="sia-grantee-count" aria-live="polite">{t('{filteredLinks} de {links} destinatarios', { filteredLinks: filteredLinks.length, links: links.length })}</p>
      {filteredLinks.length ? <ul className="sia-email-link-list" aria-label={t('Destinatarios vinculados por correo exacto')}>
        {visibleLinks.map((link, index) => <li className="sia-email-link" key={`${link.value}-${index}`}>
          <strong>{link.value}</strong>
          <div className="sia-email-link-sides">
            {describeSiaGranteeLink(link).sides.map((side) => {
              const isMatched = side.status === 'matched';
              const tone = isMatched ? 'success' : side.status === 'ambiguous' ? 'warning' : 'neutral';
              return <span className="sia-email-link-side" key={side.source}>
                <span>{side.sourceLabel}</span>
                <StatusBadge tone={tone}>{side.statusLabel}</StatusBadge>
                {side.displayName ? <span>{side.displayName}</span> : null}
              </span>;
            })}
          </div>
        </li>)}
      </ul> : <div className="sia-grantee-empty">
        <span>{t('Ningún destinatario coincide con los filtros')}</span>
        <button type="button" className="button subtle" onClick={clearFilters}>Limpiar filtros</button>
      </div>}
      {remaining > 0 ? <button
        type="button"
        className="button subtle sia-grantee-more"
        onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
      >{t('Mostrar {remaining} más', { remaining: Math.min(PAGE_SIZE, remaining) })}</button> : null}
    </div> : null}
    <div className="sia-recipient-subsection sia-name-references">
      <h4>{t('Referencia por nombre')}</h4>
      {grantedCount ? <div className="sia-grantee-list">
        {policy.attributes.granted_users.map((name) => <IdentityChip key={`u-${name}`} name={name} kind="user" subtitle="usuario · referencia por nombre" onSelect={() => onNavigate('identityUsers', name)} />)}
        {policy.attributes.granted_groups.map((name) => <IdentityChip key={`g-${name}`} name={name} kind="group" subtitle="grupo · referencia por nombre" onSelect={() => onNavigate('identityGroups', name)} />)}
        {policy.attributes.granted_roles.map((name) => {
          const target = siaGranteeTarget(name, 'role');
          return <IdentityChip key={`r-${name}`} name={name} kind={target.kind} subtitle={target.kind === 'group' ? t('grupo Okta · referencia por nombre') : t('rol · referencia por nombre')} onSelect={() => onNavigate(target.view, name)} />;
        })}
      </div> : <span className="muted">{t('Sin usuarios, roles o grupos otorgados')}</span>}
    </div>
  </section>;
}
