import { Broom } from 'lucide-react';
import { HelpHint } from '../../../cross/components/help-hint';
import { usePamCleanupSignals } from '../hooks/use-pam-cleanup-signals';
import { PamCleanupSignalsView } from './pam-cleanup-signals-view';
import './pam-cleanup-workspace.css';
import { t } from '../../../cross/i18n/index.ts';

type PamCleanupWorkspaceProps = {
  authChecked: boolean;
  authenticated: boolean;
  onUnauthorized: () => void;
};

export function PamCleanupWorkspace({ authChecked, authenticated, onUnauthorized }: PamCleanupWorkspaceProps) {
  const { data, loading, error } = usePamCleanupSignals({ authChecked, authenticated, onUnauthorized });

  return <section className="list-panel database-surface pam-cleanup-panel" aria-label={t('Señales de limpieza PAM')}>
    <header className="pam-cleanup-heading">
      <div className="section-title"><Broom size={15} aria-hidden /><h3>{t('Señales de limpieza')}</h3><HelpHint label={t('Señales de limpieza')}>
        <p>Solo lectura: revisión de grupos, PSM, plataformas y Safes con los datos cargados. «Activo» sigue el estado del inventario; la baja se decide y ejecuta en CyberArk.</p>
        <p>Las categorías se superponen: sus conteos no suman objetos únicos. Son señales para revisión; no implican bajas ni eliminaciones automáticas.</p>
        <p>{t('El cálculo y la evidencia de ingesta están en el detalle de cada categoría.')}</p>
      </HelpHint></div>
    </header>
    <PamCleanupSignalsView
      data={data}
      loading={!authChecked || (authenticated && loading)}
      error={error}
    />
  </section>;
}
