import { FileLock2, PlugZap, ShieldCheck } from 'lucide-react';

const nextSteps = [
  { icon: PlugZap, title: 'Definir el contrato', detail: 'Confirmá endpoints, permisos, paginación y los campos permitidos antes de conectar Netskope.' },
  { icon: ShieldCheck, title: 'Configurar acceso', detail: 'Asigná el rol Netskope · Lector o Netskope · Administrador a las personas que deban entrar.' },
];

export function NetskopeWorkspace() {
  return <section className="netskope-workspace" aria-labelledby="netskope-status-title">
    <div className="netskope-status-card">
      <span className="netskope-status-icon"><FileLock2 size={22} aria-hidden /></span>
      <div>
        <p className="eyebrow">NETSKOPE DLP</p>
        <h2 id="netskope-status-title">Workspace habilitado</h2>
        <p>La navegación y los permisos de Netskope ya están disponibles. Todavía no hay una fuente configurada ni datos sincronizados.</p>
      </div>
    </div>
    <div className="netskope-next-steps" aria-label="Próximos pasos para Netskope">
      {nextSteps.map(({ icon: Icon, title, detail }) => <article key={title}><span><Icon size={18} aria-hidden /></span><div><h3>{title}</h3><p>{detail}</p></div></article>)}
    </div>
  </section>;
}
