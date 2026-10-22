import { DateTime } from '../../../cross/components/date-time';
import { IdentityMembershipPanel } from './identity-membership';
import { ArrowUpRight, Database, GitBranch, Link2, PlugZap, UserCog, X } from 'lucide-react';
import { Field } from '../../../cross/components/dashboard';
import { StandardSeatBadge } from '../../shared/components/standard-seat-badge';
import { StateBlock } from '../../../cross/components/state-block';
import { ChainGraph } from '../../../cross/components/chain-graph';
import { IdentityChip, StatusBadge, TagChip } from '../../../cross/components/semantic';
import { formatNumber } from '../../../cross/lib/format';
import { federationBadgeLabel, federationBadgeTone, federationDrawerSummary, FEDERATION_DERIVED_DESCRIPTION } from '../lib/federation-resolution';
import type { IdentityLayerFreshness } from '../types/identity';
import type { WorkspaceView } from '../../../cross/lib/workspaces';
import { useIdentityDrawer } from '../hooks/use-identity-drawer';
import { useDialogFocusTrap } from '../../../cross/hooks/use-dialog-focus-trap';
import { personGraphNodes } from '../../../cross/lib/chain-graph-nodes';
import { identityPamLinkView } from '../../../cross/lib/identity-pam-link';
import { openIdentityChain } from '../../../cross/lib/identity-chain-link';
import './identity-drawer.css';

const LAYER_LABELS: Record<string, string> = { users: 'Usuarios (SCIM)', roles: 'Roles y grupos (SCIM)', members_directory: 'Directorio de cuentas técnicas', federations: 'Federaciones' };

/** Which sync layer produced the record being shown, and how fresh that layer is.
 * A failed latest attempt keeps the previous data: say so instead of hiding it. */
function LayerFreshness({ stage, layers }: { stage: string; layers: IdentityLayerFreshness[] }) {
  const layer = layers.find((item) => item.stage === stage);
  if (!layer) return null;
  const failed = layer.last_status === 'failed';
  return <section className="detail-section">
    <div className="detail-section-heading"><h3>Origen del dato</h3><StatusBadge tone={failed ? 'warning' : 'success'}>{failed ? 'Último intento fallido' : 'Al día'}</StatusBadge></div>
    <p className="detail-summary-copy">
      Capa «{LAYER_LABELS[stage] || stage}»: {layer.last_success_at ? <>última verificación correcta <DateTime value={layer.last_success_at} /></> : 'sin verificación correcta registrada'}.
      {failed ? <> El último intento (<DateTime value={layer.last_attempt_at} />) falló: se conserva el dato anterior y no se retiró nada de esta capa.</> : ''}
    </p>
  </section>;
}

type IdentityDrawerController = ReturnType<typeof useIdentityDrawer>;

type IdentityDrawerProps = {
  controller: IdentityDrawerController;
  onNavigate: (view: WorkspaceView, query?: string) => void;
};

export function IdentityDrawer({ controller, onNavigate }: IdentityDrawerProps) {
  const { target, layerFreshness, userDetail, roleDetail, pamChain, pamChainLoading, loading, error, open, close, reload } = controller;
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ active: Boolean(target), onClose: close });
  if (!target) return null;

  const isUser = target.kind === 'user';
  const kindLabel = isUser ? 'Usuario' : 'Rol o grupo';
  const pamLink = identityPamLinkView(pamChain);

  return <div ref={dialogRef} className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="identity-drawer-title" tabIndex={-1}>
    <button className="drawer-backdrop" type="button" aria-label="Cerrar detalle de identidad" onClick={close} />
    <aside className="detail-drawer identity-drawer">
      <div className="detail-title">
        <div className="detail-icon"><UserCog size={18} /></div>
        <div className="detail-heading">
          <p className="eyebrow">IDENTIDADES · {kindLabel.toUpperCase()}</p>
          <h2 id="identity-drawer-title">{target.name}</h2>
          <p>Cuentas, roles y grupos registrados</p>
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
            <Field label="Estado"><StatusBadge tone={userDetail.user.attributes.active ? 'success' : 'neutral'}>{userDetail.user.attributes.active === true ? 'Activo' : userDetail.user.attributes.active === false ? 'Inactivo' : 'Sin dato'}</StatusBadge></Field>
            <Field label="Tipo"><span className="detail-value">{userDetail.user.attributes.service_user ? 'Cuenta técnica' : 'Persona'}</span></Field>
            <Field label="Asiento Standard">{userDetail.user.standard_seat_reconciled ? <StandardSeatBadge reconciled context="identity" /> : <span className="detail-value">Sin conciliación PAM</span>}</Field>
            <Field label="Último acceso"><span className="detail-value">{userDetail.user.attributes.last_login_date ? <DateTime value={userDetail.user.attributes.last_login_date} /> : 'Sin dato'}</span></Field>
            <Field label="Visto"><span className="detail-value"><DateTime value={userDetail.user.first_seen_at} /> → <DateTime value={userDetail.user.last_seen_at} /></span></Field>
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-section-heading"><h3><Link2 size={15} aria-hidden style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />Federación de ingreso</h3></div>
          <p className="detail-summary-copy">{federationDrawerSummary(userDetail.user.federation_resolution)}</p>
          {userDetail.user.federation_resolution && <div className="identity-federation-badge">
            <StatusBadge tone={federationBadgeTone(userDetail.user.federation_resolution)}>{federationBadgeLabel(userDetail.user.federation_resolution)}</StatusBadge>
            <TagChip label="Derivada por dominio" title={FEDERATION_DERIVED_DESCRIPTION} />
          </div>}
        </section>

        <LayerFreshness stage={userDetail.user.attributes.record_source === 'identity_directory' ? 'members_directory' : 'users'} layers={layerFreshness} />

        <section className="detail-section">
          <div className="detail-section-heading"><h3>Roles <span>{formatNumber(userDetail.roles.length)}</span></h3></div>
          {userDetail.roles.length
            ? <div className="identity-expand-list">{userDetail.roles.map((role) => <IdentityChip key={role.object_id} name={role.display_name} kind={role.display_name.toLowerCase().startsWith('sg_cyberark') ? 'group' : 'role'} subtitle={role.display_name.toLowerCase().startsWith('sg_cyberark') ? 'Grupo de Okta' : 'Rol de CyberArk'} onSelect={() => open({ kind: 'role', objectId: role.object_id, name: role.display_name })} />)}</div>
            : <p className="muted">Sin roles asignados</p>}
        </section>

        <section className="detail-section">
          <div className="detail-section-heading"><div><h3>Cadena PAM</h3><p className="detail-summary-copy">{pamLink.heading}</p></div><StatusBadge tone={pamLink.tone}>{pamLink.badge}</StatusBadge></div>
          {pamChainLoading && !pamChain
            ? <p className="muted">Buscando equivalencia…</p>
            : !pamChain || !pamChain.matched
              ? <p className="muted">{pamLink.emptyCopy}</p>
              : <>
                  <ChainGraph title="Recorrido de acceso" description="Camino verificado desde la persona hasta la sesión administrada." nodes={personGraphNodes(pamChain, target.name, pamLink.originDescription)} statusLabel={pamLink.statusLabel} />
                  <p className="identity-pam-totals"><span className="metric-num">{formatNumber(pamChain.totals.roles)}</span> roles · <span className="metric-num">{formatNumber(pamChain.totals.safes)}</span> safes · <span className="metric-num">{formatNumber(pamChain.totals.accounts)}</span> cuentas</p>
                  <div className="identity-pam-roles">{pamChain.roles.map((role) => <div className="identity-pam-role" key={role.object_id}>
                    <div className="identity-pam-role-head"><strong>{role.display_name}</strong><span className="muted">{formatNumber(role.safe_count)} {role.safe_count === 1 ? 'safe' : 'safes'}</span></div>
                    <div className="tag-chip-list">{role.safes.map((safe) => <TagChip key={safe.object_id} label={safe.display_name + ' · ' + formatNumber(safe.account_count) + 'c'} title={'Safe ' + safe.safe_number + ' · ' + formatNumber(safe.account_count) + ' cuentas'} />)}{role.safe_count > role.safes.length ? <TagChip label={'+' + formatNumber(role.safe_count - role.safes.length) + ' más'} /> : null}</div>
                  </div>)}{pamChain.roles_omitted > 0 ? <p className="muted">+{formatNumber(pamChain.roles_omitted)} roles más no mostrados</p> : null}</div>
                </>}
        </section>
      </>}

      {!loading && !error && !isUser && roleDetail && <>
        <section className="detail-section"><div className="detail-section-heading"><h3>Rol o grupo</h3></div><div className="form-grid">
          <Field label="Nombre"><span className="detail-value">{roleDetail.role.display_name}</span></Field>
          <Field label="Miembros directos"><span className="detail-value">{roleDetail.role.attributes.direct_member_count === undefined ? 'Pendiente de sincronización' : formatNumber(roleDetail.role.attributes.direct_member_count)}</span></Field>
          <Field label="Visto"><span className="detail-value"><DateTime value={roleDetail.role.first_seen_at} /> → <DateTime value={roleDetail.role.last_seen_at} /></span></Field>
        </div></section>
        <LayerFreshness stage="roles" layers={layerFreshness} />
        <IdentityMembershipPanel objectId={target.objectId} />
      </>}

      {!loading && !error && <section className="detail-section"><div className="detail-section-heading"><div><h3>Saltos a otros módulos</h3><p className="detail-summary-copy">Saltos a otros dominios con el nombre precargado. SIA no expone el UUID: ese vínculo es por nombre, verificá que sea la misma persona.</p></div></div>
        <div className="identity-conn-list">
          {isUser && pamChain?.matched && pamChain.pam_user ? <button type="button" className="identity-conn-link" onClick={() => openIdentityChain(onNavigate, pamChain.pam_user!.object_id)}><span className="identity-conn-icon"><GitBranch size={15} /></span><span className="identity-conn-text"><strong>Ver en Acceso</strong><small>De la persona a su usuario PAM, roles, Safes y conectores</small></span><ArrowUpRight size={15} /></button> : null}
          <button type="button" className="identity-conn-link" onClick={() => onNavigate('safes', target.name)}><span className="identity-conn-icon"><Database size={15} /></span><span className="identity-conn-text"><strong>Buscar en Safes PAM</strong><small>Filtra el inventario por "{target.name}"</small></span><ArrowUpRight size={15} /></button>
          <button type="button" className="identity-conn-link" onClick={() => onNavigate('graph')}><span className="identity-conn-icon"><GitBranch size={15} /></span><span className="identity-conn-text"><strong>Ver Cadena PAM</strong><small>Recorrido verificado usuarios → roles → Safes → plataformas → PSM</small></span><ArrowUpRight size={15} /></button>
          <button type="button" className="identity-conn-link" onClick={() => onNavigate('sia', target.name)}><span className="identity-conn-icon"><PlugZap size={15} /></span><span className="identity-conn-text"><strong>Buscar en SIA</strong><small>Filtra las políticas de acceso por "{target.name}"</small></span><ArrowUpRight size={15} /></button>
        </div>
      </section>}
    </aside>
  </div>;
}
