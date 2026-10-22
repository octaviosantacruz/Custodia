import { company, people, devices, safes, accounts, coverageSummary, validMode } from './company';
import './company.css';

export function CompanyContext() {
  const mode = validMode(sessionStorage.getItem('faro-source-mode'));
  const counts = coverageSummary(mode).counts;
  return <aside className="company-context" aria-label="Contexto de la empresa ficticia">
    <div className="company-context-heading">
      <div><strong>{company.name}</strong><span>Empresa ficticia · {company.industry} · Demo de sólo lectura</span></div>
      <span className="company-capture">Captura de ejemplo · 22 oct 2026, 14:00 UTC</span>
      <label>Fuente Netskope <select value={mode} onChange={e => { sessionStorage.setItem('faro-source-mode', e.target.value); location.reload(); }}>
        <option value="complete">Completa y vigente</option><option value="stale">Vencida (73 horas)</option><option value="partial">Parcial</option>
      </select></label>
    </div>
    <div className="company-context-line">
      <span>{people.length} personas · {company.areas.length} áreas · {devices.length} equipos · {safes.length} Safes · {accounts.length} cuentas privilegiadas</span>
      <nav aria-label="Recorridos de la empresa"><a href="/chains/person">Personas</a><a href="/pam/safes">Safes</a><a href="/netskope/inventory?freshness=all">Equipos Netskope</a></nav>
    </div>
    <details>
      <summary>Casos de la empresa · {counts.covered} con cobertura Netskope, {counts.partial} parciales, {counts.gap} brechas, {counts.unknown} desconocidos</summary>
      <div className="company-cases">
        {people.map(person => <article key={person.id}><a href={`/chains/person?email=${encodeURIComponent(person.email)}`}>{person.name}</a><small>{person.area} · {person.site}</small><p>{person.case}</p></article>)}
      </div>
      <p className="company-limits">Datos y sesión simulados, sin conexión a fabricantes. Revisión de sólo lectura. La cobertura Netskope no demuestra cobertura de CrowdStrike; ese adaptador está pendiente. Una brecha es un caso para revisar, no un incidente confirmado.</p>
    </details>
  </aside>;
}
