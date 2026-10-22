import { useState } from 'react';
import { people, type CoverageStatus } from '../model/company.ts';
import { personView, SOURCES, VERDICT_LABEL, type SourceKey } from '../model/view.ts';
import { Seal, Verdict, VerdictGlyph } from '../ui/identity.tsx';
import { Link, useApp } from '../ui/router.tsx';
import { Shell } from '../ui/shell.tsx';

type Filter = CoverageStatus | 'all';

/** Celda de presencia: el sello dice qué fuente; el trazo, cómo se unió. */
function Presence({ source, status, count, what }: { source: SourceKey; status: string; count?: number; what: string }) {
  const label = status === 'matched' ? 'por correo exacto' : status === 'ambiguous' ? `ambiguo, ${count} registros` : 'sin registro';
  return (
    <span className={`presence is-${status}`} data-src={source} title={`${SOURCES[source].product}, ${what}: ${label}`}>
      <span className="presence-dot" aria-hidden="true" />
      <span className="sr-only">{SOURCES[source].product}, {what}: {label}</span>
      {status === 'ambiguous' && <span className="presence-count" aria-hidden="true">{count}</span>}
    </span>
  );
}

export function People() {
  const { mode } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const rows = people.map(person => personView(person, mode));
  const shown = rows.filter(row => filter === 'all' || row.coverage.status === filter);
  const count = (status: CoverageStatus) => rows.filter(row => row.coverage.status === status).length;

  return (
    <Shell title="Personas" lede="Cada persona y lo que cada fuente registra de ella.">
      <div className="toolbar" role="group" aria-label="Filtrar por veredicto">
        <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todas <span className="data">{rows.length}</span></button>
        {(['gap', 'partial', 'unknown', 'covered'] as CoverageStatus[]).map(status => (
          <button key={status} type="button" className="chip" aria-pressed={filter === status} onClick={() => setFilter(status)} disabled={count(status) === 0}>
            <VerdictGlyph status={status} /> {VERDICT_LABEL[status]} <span className="data">{count(status)}</span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Personas de Acme Corp con su presencia por fuente y veredicto</caption>
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col">Área</th>
              <th scope="col" className="is-center"><Seal source="pam" label="none" /> Identidad</th>
              <th scope="col" className="is-center"><Seal source="pam" label="none" /> Privilegios</th>
              <th scope="col" className="is-center"><Seal source="sse" label="none" /> Usuario</th>
              <th scope="col" className="is-num"><abbr title="Equipos con señal en 7 días">Con señal</abbr></th>
              <th scope="col">Veredicto</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <tr key={row.person.id}>
                <td>
                  <Link to={`/personas/${row.person.id}`} className="row-link">{row.person.name}</Link>
                  <span className="data muted block">{row.person.email}</span>
                </td>
                <td>{row.person.area}<span className="muted block">{row.person.site}</span></td>
                <td className="is-center"><Presence source="pam" status={row.identity.status} count={row.person.identityIds.length} what="identidad" /></td>
                <td className="is-center"><Presence source="pam" status={row.pam.status} what="privilegios" /></td>
                <td className="is-center"><Presence source="sse" status={row.sse.status} what="usuario" /></td>
                <td className="is-num data">{row.devices.filter(d => d.recent).length}/{row.devices.length}</td>
                <td><Verdict status={row.coverage.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legend-line">
        <span><span className="presence is-matched" data-src="pam"><span className="presence-dot" /></span> unido por correo exacto</span>
        <span><span className="presence is-ambiguous" data-src="pam"><span className="presence-dot" /></span> ambiguo: no se une solo</span>
        <span><span className="presence is-unmatched" data-src="pam"><span className="presence-dot" /></span> sin registro</span>
      </p>
    </Shell>
  );
}
