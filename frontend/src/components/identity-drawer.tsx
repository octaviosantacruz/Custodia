import { ArrowUpRight, Database, GitBranch, Link2, PlugZap, UserCog, X } from 'lucide-react';
import { Field } from './dashboard';
import { StandardSeatBadge } from './standard-seat-badge';
import { StateBlock } from './state-block';
import { ChainGraph } from './chain-graph';
import { IdentityChip, StatusBadge, TagChip } from './semantic';
import { formatDate, formatNumber } from '../lib/format';
import { federationBadgeLabel, federationBadgeTone, federationDrawerSummary } from '../lib/federation-resolution';
import type { WorkspaceView } from '../lib/workspaces';
import { useIdentityDrawer } from '../hooks/use-identity-drawer';
import { useDialogFocusTrap } from '../hooks/use-dialog-focus-trap';
import { personGraphNodes } from '../lib/chain-graph-nodes';

type IdentityDrawerController = ReturnType<typeof useIdentityDrawer>;

type IdentityDrawerProps = {
  controller: IdentityDrawerController;
  onNavigate: (view: WorkspaceView, query?: string) => void;
};

export function IdentityDrawer({ controller, onNavigate }: IdentityDrawerProps) {
  const { target, userDetail, roleDetail, pamChain, pamChainLoading, loading, error, open, close, reload } = controller;
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ active: Boolean(target), onClose: close });
  if (!target) return null;

  const isUser = target.kind === 'user';
  const kindLabel = isUser ? 'Usuario' : 'Rol';

  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="identity-drawer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label="Cerrar detalle de identidad" onClick={close} />
    <aside className="detail-drawer identity-drawer">
      <div className="detail-title">
        <div className="detail-icon"><UserCog size={18} /></div>
        <div className="detail-heading">
          <p className="eyebrow">IDENTITY ADMINISTRATION · {kindLabel.toUpperCase()}</p>
          <h2 id="identity-drawer-title">{target.name}</h2>
          <p>Directorio SCIM · fuente separada de la cadena PAM</p>
        </div>
        <button className="icon-button drawer-close" type="button" title="Cerrar" aria-label="Cerrar" onClick={close}><X size={16} /></button>
      </div>

      {loading && <section className="detail-section"><StateBlock variant="loading" title="Cargando detalle…" /></section>}
      {!loading && error && <section className="detail-section"><StateBlock variant="error" title="No se pudo cargar el detalle" hint={error} action={<button type="button" className="button subtle" onClick={() => void reload()}>Reintentar</button>} /></section>}

      {!loading && !error && isUser && userDetail && <>
        <section className="detail-section">
          <div className="detail-section-heading"><h3>Identidad</h3></div>
          <div className="form-grid">
            <Field label="Nombre visible"><span className="detail-value">{userDetail.user.display_name}</span></Field>
            <Field label="Usuario"><span className="detail-value">{userDetail.user.attributes.user_name || 'Sin dato'}</span></Field>
            <Field label="Email"><span className="detail-value">{userDetail.user.attributes.email || 'Sin dato'}</span></Field>
            <Field label="Estado"><StatusBadge tone={userDetail.user.attributes.active ? 'success' : 'neutral'}>{userDetail.user.attributes.active ? 'Activo' : 'Inactivo'}</StatusBadge></Field>
            <Field label="Tipo"><span className="detail-value">{userDetail.user.attributes.service_user ? 'Cuenta técnica' : 'Persona'}</span></Field>
            <Field label="Asiento Standard">{userDetail.user.standard_seat_reconciled ? <StandardSeatBadge reconciled context="identity" /> : <span className="detail-value">Sin conciliación PAM por UUID</span>}</Field>
            <Field label="Último acceso"><span className="detail-value">{userDetail.user.attributes.last_login_date ? formatDate(userDetail.user.attributes.last_login_date) : 'Sin dato'}</span></Field>
            <Field label="Identificador"><span className="detail-value mono">{userDetail.user.source_id}</span></Field>
            <Field label="Visto"><span className="detail-value">{formatDate(userDetail.user.first_seen_at)} → {formatDate(userDetail.user.last_seen_at)}</span></Field>
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-section-heading"><h3><Link2 size={15} aria-hidden style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Federación de ingreso</h3></div>
          <p className="detail-summary-copy">{federationDrawerSummary(userDetail.user.federation_resolution)}</p>
          {userDetail.user.federation_resolution && <div className="identity-federation-badge">
            <StatusBadge tone={federationBadgeTone(userDetail.user.federation_resolution)}>{federationBadgeLabel(userDetail.user.federation_resolution)}</StatusBadge>
            <TagChip label="Derivada por dominio" title="Clasificación calculada por regla de negocio (dominio de correo), no una relación entregada por la API de Identity Administration" />
          </div>}
        </section>

        <section className="detail-section">
          <div className="detail-section-heading"><h3>Roles <span>{formatNumber(userDetail.roles.length)}</span></h3></div>
          {userDetail.roles.length
            ? <div className="identity-expand-list">{userDetail.roles.map((role) => <IdentityChip key={role.object_id} name={role.display_name} kind="role" subtitle={role.source_id} onSelect={() => open({ kind: 'role', objectId: role.object_id, name: role.display_name })} />)}</div>
            : <p className="muted">Sin roles asignados</p>}
        </section>

        <section className="detail-section">
          <div className="detail-section-heading"><div><h3>Cadena PAM</h3><p className="detail-summary-copy">Coincidencia por UUID de CyberArk Identity (mismo identificador en ambas fuentes), no por nombre.</p></div></div>
          {pamChainLoading && !pamChain
            ? <p className="muted">Buscando equivalencia…</p>
            : !pamChain || !pamChain.matched
              ? <p className="muted">Sin equivalencia en la cadena PAM. Este usuario no comparte el UUID de CyberArk Identity con ningún usuario PAM.</p>
              : <>
                  <ChainGraph title="Recorrido de acceso" description="Camino verificado desde la persona hasta la sesión administrada." nodes={personGraphNodes(pamChain, target.name, 'UUID de Identity coincidente')} statusLabel="UUID verificado" />
                  <p className="identity-pam-totals"><span className="metric-num">{formatNumber(pamChain.totals.roles)}</span> roles · <span className="metric-num">{formatNumber(pamChain.totals.safes)}</span> safes · <span className="metric-num">{formatNumber(pamChain.totals.accounts)}</span> cuentas</p>
                  <div className="identity-pam-roles">{pamChain.roles.map((role) => <div className="identity-pam-role" key={role.object_id}>
                    <div className="identity-pam-role-head"><strong>{role.display_name}</strong><span className="muted">{formatNumber(role.safe_count)} {role.safe_count === 1 ? 'safe' : 'safes'}</span></div>
                    <div className="tag-chip-list">{role.safes.map((safe) => <TagChip key={safe.object_id} label={safe.display_name + ' · ' + formatNumber(safe.account_count) + 'c'} title={'Safe ' + safe.safe_number + ' · ' + formatNumber(safe.account_count) + ' cuentas'} />)}{role.safe_count > role.safes.length ? <TagChip label={'+' + formatNumber(role.safe_count - role.safes.length) + ' más'} /> : null}</div>
                  </div>)}{pamChain.roles_omitted > 0 ? <p className="muted">+{formatNumber(pamChain.roles_omitted)} roles más no mostrados</p> : null}</div>
                </>}
        </section>
      </>}

      {!loading && !error && !isUser && roleDetail && <>
        <section className="detail-section"><div className="detail-section-heading"><h3>Rol</h3></div><div className="form-grid">
          <Field label="Nombre"><span className="detail-value">{roleDetail.role.display_name}</span></Field>
          <Field label="Identificador"><span className="detail-value mono">{roleDetail.role.source_id}</span></Field>
          <Field label="Miembros"><span className="detail-value">{formatNumber(roleDetail.role.member_count)}</span></Field>
          <Field label="Visto"><span className="detail-value">{formatDate(roleDetail.role.first_seen_at)} → {formatDate(roleDetail.role.last_seen_at)}</span></Field>
        </div></section>
        <section className="detail-section"><div className="detail-section-heading"><h3>Miembros <span>{formatNumber(roleDetail.members.length)}</span></h3></div>
          {roleDetail.members.length ? <div className="identity-expand-list">{roleDetail.members.map((member) => <IdentityChip key={member.object_id} name={member.display_name} kind="user" subtitle={member.source_id} onSelect={() => open({ kind: 'user', objectId: member.object_id, name: member.display_name })} />)}</div> : <p className="muted">Sin miembros</p>}
        </section>
      </>}

      {!loading && !error && <section className="detail-section"><div className="detail-section-heading"><div><h3>Conexiones</h3><p className="detail-summary-copy">Saltos a otros dominios con el nombre precargado. SIA no expone el UUID: ese vínculo es por nombre, verificá que sea la misma persona.</p></div></div>
        <div className="identity-conn-list">
          <button type="button" className="identity-conn-link" onClick={() => onNavigate('safes', target.name)}><span className="identity-conn-icon"><Database size={15} /></span><span className="identity-conn-text"><strong>Buscar en Safes PAM</strong><small>Filtra el inventario por "{target.name}"</small></span><ArrowUpRight size={15} /></button>
          <button type="button" className="identity-conn-link" onClick={() => onNavigate('graph')}><span className="identity-conn-icon"><GitBranch size={15} /></span><span className="identity-conn-text"><strong>Ver Cadena PAM</strong><small>Recorrido verificado usuarios → roles → Safes → plataformas → PSM</small></span><ArrowUpRight size={15} /></button>
          <button type="button" className="identity-conn-link" onClick={() => onNavigate('sia', target.name)}><span className="identity-conn-icon"><PlugZap size={15} /></span><span className="identity-conn-text"><strong>Buscar en SIA</strong><small>Filtra las políticas de acceso por "{target.name}"</small></span><ArrowUpRight size={15} /></button>
        </div>
      </section>}
    </aside>
  </div>;
}
