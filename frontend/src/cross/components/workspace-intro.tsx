import { DateTime } from './date-time';
import { HelpHint } from './help-hint';
import type { WorkspaceIntroHelp } from '../../source-contract';
import './workspace-intro.css';
import { syncStatusLabel } from '../lib/sync-source';
import type { IngestionRun } from '../types/ingestion';

type WorkspaceIntroProps = {
  title: string;
  description: string;
  help?: WorkspaceIntroHelp;
  latestRun: IngestionRun | null;
  showRunSummary: boolean;
};

export function WorkspaceIntro({ title, description, help, latestRun, showRunSummary }: WorkspaceIntroProps) {
  return <section className="intro">
    <div><div className="workspace-intro-heading"><h1>{title}</h1>{help && <HelpHint label={help.label}>{help.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</HelpHint>}</div><p className="intro-copy">{description}</p></div>
    {showRunSummary && <div className="run-summary">{latestRun ? <><strong>Última sincronización {syncStatusLabel(latestRun.status).toLocaleLowerCase('es')}</strong><span><DateTime value={latestRun.completed_at || latestRun.started_at} /></span></> : 'Sin sincronizaciones registradas'}</div>}
  </section>;
}
