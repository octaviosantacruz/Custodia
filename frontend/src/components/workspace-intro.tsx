import { formatDate } from '../lib/format';
import type { IngestionRun } from '../types/ingestion';

type WorkspaceIntroProps = {
  title: string;
  description: string;
  latestRun: IngestionRun | null;
  showRunSummary: boolean;
};

function relativeTime(value: string | null): string {
  if (!value) return 'Sin actividad registrada';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Hace menos de un minuto';
  if (minutes < 60) return 'Hace ' + minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'Hace ' + hours + (hours === 1 ? ' hora' : ' horas');
  const days = Math.floor(hours / 24);
  return 'Hace ' + days + (days === 1 ? ' día' : ' días');
}

export function WorkspaceIntro({ title, description, latestRun, showRunSummary }: WorkspaceIntroProps) {
  return <section className="intro">
    <div><p className="eyebrow">DS HUB / {title.toUpperCase()}</p><h1>{title}</h1><p className="intro-copy">{description}</p></div>
    {showRunSummary && <div className="run-summary">{latestRun ? <><strong>Última sincronización {latestRun.status}</strong><span>{relativeTime(latestRun.completed_at || latestRun.started_at)} · {formatDate(latestRun.completed_at || latestRun.started_at)}</span></> : 'Sin sincronizaciones registradas'}</div>}
  </section>;
}
