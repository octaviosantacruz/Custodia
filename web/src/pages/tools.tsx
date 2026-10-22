import { Fragment, useId, useState, type ReactNode } from 'react';
import { ago, sourceRun, SOURCES, type SourceKey } from '../model/view.ts';
import {
  cyberarkAccounts, cyberarkIdentities, cyberarkPlatforms, cyberarkRoles, cyberarkSafes,
  netskopeDevices, netskopeUsers, netskopeVersions, type Bond, type Raw,
} from '../model/tools.ts';
import { Seal } from '../ui/identity.tsx';
import { Link, useApp } from '../ui/router.tsx';
import { Shell } from '../ui/shell.tsx';

type Column<T> = { label: string; render: (row: T) => ReactNode; num?: boolean };
type Row = { id: string; raw: Raw; bonds?: Bond[] };

/** Vínculo propuesto por Custodia: a quién y por qué. No es dato de la fuente. */
function Bonds({ bonds }: { bonds?: Bond[] }) {
  if (!bonds?.length) return <span className="muted">—</span>;
  return (
    <ul className="bonds">
      {bonds.map(bond => (
        <li key={bond.person.id + bond.basis} className={bond.basis === 'ambiguo, sin unir' ? 'is-ambiguous' : undefined}>
          <Link to={`/personas/${bond.person.id}`}>{bond.person.name}</Link>
          <span className="muted"> · {bond.basis}</span>
        </li>
      ))}
    </ul>
  );
}

function ToolTable<T extends Row>({ caption, rows, columns, searchValues, bonds = true }: {
  caption: string; rows: T[]; columns: Column<T>[]; searchValues: (row: T) => (string | number)[]; bonds?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const searchId = useId();
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? rows.filter(row => [
    JSON.stringify(row.raw), ...searchValues(row),
    ...(bonds ? row.bonds?.flatMap(bond => [bond.person.name, bond.basis]) ?? [] : []),
  ].join(' ').toLocaleLowerCase().includes(needle)) : rows;
  const span = columns.length + (bonds ? 2 : 1);

  return (
    <>
      <div className="toolbar is-search">
        <label htmlFor={searchId} className="sr-only">Buscar en {caption}</label>
        <input id={searchId} type="search" className="search" placeholder="Buscar en cualquier atributo" value={query} onChange={event => setQuery(event.target.value)} />
        <span className="muted data" aria-live="polite">{shown.length} de {rows.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map(column => <th key={column.label} scope="col" className={column.num ? 'is-num' : undefined}>{column.label}</th>)}
              {bonds && <th scope="col" className="is-bond">Vínculo <span className="th-note">Custodia</span></th>}
              <th scope="col"><span className="sr-only">Atributos</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <Fragment key={row.id}>
                <tr className={open === row.id ? 'is-open' : undefined}>
                  {columns.map(column => <td key={column.label} className={column.num ? 'is-num data' : undefined}>{column.render(row)}</td>)}
                  {bonds && <td className="is-bond"><Bonds bonds={row.bonds} /></td>}
                  <td className="is-action">
                    <button type="button" className="row-toggle" aria-expanded={open === row.id} onClick={() => setOpen(open === row.id ? null : row.id)}>
                      <span className="sr-only">Atributos de {row.id}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </td>
                </tr>
                {open === row.id && (
                  <tr className="raw-row">
                    <td colSpan={span}>
                      <p className="label">Atributos tal como los entrega la fuente</p>
                      <dl className="raw">
                        {Object.entries(row.raw).map(([key, value]) => (
                          <div key={key}><dt className="data">{key}</dt><dd className="data">{value === null ? 'null' : String(value)}</dd></div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ToolPage({ source, module, title, lede, children }: { source: SourceKey; module: string; title: string; lede: string; children: ReactNode }) {
  const { mode } = useApp();
  const run = sourceRun(source, mode);
  return (
    <Shell title={title} lede={lede} actions={<Seal source={source} label="product" />}>
      <p className="run-line" data-src={source}>
        <span className="label">{SOURCES[source].product} · {module}</span>
        <span className="data">{run.run_id}</span>
        <span className="muted">{run.status === 'completed' ? 'completa' : 'parcial'} · hace {run.age_hours} h</span>
        <span className="muted">Lo que dice la herramienta, sin conclusiones.</span>
      </p>
      {children}
    </Shell>
  );
}

const list = (items: string[]) => items.length ? items.join(', ') : <span className="muted">—</span>;

export function Identities() {
  return (
    <ToolPage source="pam" module="Identity" title="Identidades" lede="Identidades activas del directorio de CyberArk Identity.">
      <ToolTable caption="Identidades de CyberArk" rows={cyberarkIdentities()}
        searchValues={r => [r.name, r.id, r.email, r.state, ...r.roles]} columns={[
        { label: 'Identidad', render: r => <><span className="strong">{r.name}</span><span className="data muted block">{r.id}</span></> },
        { label: 'Correo', render: r => <span className="data">{r.email}</span> },
        { label: 'Estado', render: r => r.state },
        { label: 'Roles', render: r => list(r.roles) },
      ]} />
    </ToolPage>
  );
}

export function Roles() {
  return (
    <ToolPage source="pam" module="Identity" title="Roles" lede="Roles de CyberArk y los Safes a los que dan acceso.">
      <ToolTable caption="Roles de CyberArk" rows={cyberarkRoles()}
        searchValues={r => [r.name, r.id, ...r.safes]} columns={[
        { label: 'Rol', render: r => <><span className="strong">{r.name}</span><span className="data muted block">{r.id}</span></> },
        { label: 'Safes', render: r => <span className="data">{r.safes.join(', ')}</span> },
      ]} />
    </ToolPage>
  );
}

export function Safes() {
  return (
    <ToolPage source="pam" module="PAM" title="Safes" lede="Safes de CyberArk PAM con su configuración y sus miembros.">
      <ToolTable caption="Safes de CyberArk" rows={cyberarkSafes()}
        searchValues={r => [r.id, r.area, r.accounts, r.members, r.cpm, r.retention, r.review]} columns={[
        { label: 'Safe', render: r => <><span className="data strong">{r.id}</span><span className="muted block">{r.area}</span></> },
        { label: 'Cuentas', render: r => r.accounts, num: true },
        { label: 'Miembros', render: r => r.members, num: true },
        { label: 'CPM', render: r => <span className="data">{r.cpm}</span> },
        { label: 'Retención', render: r => r.retention },
        { label: 'Revisión', render: r => <span className="tag" title="Decisión registrada en Custodia, no dato de CyberArk">{r.review}</span> },
      ]} />
      <p className="hint">«Revisión» es una decisión humana guardada en Custodia; una sincronización de CyberArk no la sobrescribe.</p>
    </ToolPage>
  );
}

export function Accounts() {
  return (
    <ToolPage source="pam" module="PAM" title="Cuentas" lede="Cuentas privilegiadas por Safe y plataforma. Sin credenciales ni secretos.">
      <ToolTable caption="Cuentas de CyberArk" rows={cyberarkAccounts()}
        searchValues={r => [r.name, r.user, r.address, r.platform, r.safe, r.managed ? 'sí' : 'no']} columns={[
        { label: 'Cuenta', render: r => <span className="data strong">{r.name}</span> },
        { label: 'Usuario', render: r => <span className="data">{r.user}</span> },
        { label: 'Dirección', render: r => <span className="data">{r.address}</span> },
        { label: 'Plataforma', render: r => r.platform },
        { label: 'Safe', render: r => <span className="data">{r.safe}</span> },
        { label: 'Gestión automática', render: r => r.managed ? 'sí' : 'no' },
      ]} />
    </ToolPage>
  );
}

export function Platforms() {
  return (
    <ToolPage source="pam" module="PAM" title="Plataformas" lede="Plataformas de las cuentas privilegiadas.">
      <ToolTable caption="Plataformas de CyberArk" bonds={false} rows={cyberarkPlatforms()}
        searchValues={r => [r.id, r.accounts, r.managed, ...r.safes]} columns={[
        { label: 'Plataforma', render: r => <span className="strong">{r.id}</span> },
        { label: 'Cuentas', render: r => r.accounts, num: true },
        { label: 'Con gestión automática', render: r => r.managed, num: true },
        { label: 'Safes', render: r => <span className="data">{r.safes.join(', ')}</span> },
      ]} />
    </ToolPage>
  );
}

export function NetskopeUsers() {
  const { mode } = useApp();
  return (
    <ToolPage source="sse" module="Usuarios" title="Usuarios" lede="Usuarios de Netskope con sus equipos y su última señal.">
      <ToolTable caption="Usuarios de Netskope" rows={netskopeUsers(mode)}
        searchValues={r => [r.name, r.email, r.devices, r.recent, r.lastSignalAt ? ago(r.lastSignalAt) : 'sin equipos']} columns={[
        { label: 'Usuario', render: r => <><span className="strong">{r.name}</span><span className="data muted block">{r.email}</span></> },
        { label: 'Equipos', render: r => r.devices, num: true },
        { label: 'Con señal en 7 días', render: r => r.recent, num: true },
        { label: 'Última señal', render: r => r.lastSignalAt ? <span className="data">{ago(r.lastSignalAt)}</span> : <span className="muted">sin equipos</span> },
      ]} />
    </ToolPage>
  );
}

export function NetskopeDevices() {
  const { mode } = useApp();
  return (
    <ToolPage source="sse" module="Equipos" title="Equipos" lede="Equipos con el cliente de Netskope y su última señal.">
      <ToolTable caption="Equipos de Netskope" rows={netskopeDevices(mode).map(d => ({ ...d, id: d.deviceId }))}
        searchValues={r => [r.hostname, r.deviceId, `${r.os} ${r.osVersion}`, r.clientVersion, ago(r.lastSignalAt), r.recent ? 'con señal' : 'sin señal']} columns={[
        { label: 'Equipo', render: r => <><span className="data strong">{r.hostname}</span><span className="data muted block">{r.deviceId}</span></> },
        { label: 'Sistema', render: r => `${r.os} ${r.osVersion}` },
        { label: 'Cliente', render: r => <span className="data">{r.clientVersion}</span> },
        { label: 'Última señal', render: r => <span className="data">{ago(r.lastSignalAt)}</span> },
        { label: 'En 7 días', render: r => <span className={`signal${r.recent ? ' is-on' : ''}`}>{r.recent ? 'con señal' : 'sin señal'}</span> },
      ]} />
      <p className="hint">«Sin señal» describe lo observado, no es un veredicto: no confirma abandono ni falta de protección.</p>
    </ToolPage>
  );
}

export function NetskopeVersions() {
  const { mode } = useApp();
  return (
    <ToolPage source="sse" module="Clientes" title="Versiones de cliente" lede="Versiones del cliente de Netskope instaladas en los equipos.">
      <ToolTable caption="Versiones del cliente de Netskope" bonds={false} rows={netskopeVersions(mode)}
        searchValues={r => [r.id, r.devices, r.recent, ...r.systems]} columns={[
        { label: 'Versión', render: r => <span className="data strong">{r.id}</span> },
        { label: 'Equipos', render: r => r.devices, num: true },
        { label: 'Con señal en 7 días', render: r => r.recent, num: true },
        { label: 'Sistemas', render: r => r.systems.join(', ') },
      ]} />
    </ToolPage>
  );
}
