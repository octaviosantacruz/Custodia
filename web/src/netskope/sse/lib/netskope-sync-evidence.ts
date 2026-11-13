import type { SyncPresentationRegistration } from '../../../source-contract.ts';
import { relativeTime } from '../../../cross/lib/format.ts';
import type { NetskopeSourceEvidence } from '../types/netskope.ts';
import { t } from '../../../cross/i18n/index.ts';

/* NSK-HB-001: a count of devices by age is an observation of the last inventory; calling a device a
   review candidate is an evaluation that needs a complete, recent Netskope sync. This turns the sync
   evidence into the sentence that explains which of the two the screen is showing. */
const RUN_STATE: Record<string, string> = {
  completed: t('el último sync completo tiene más de 24 h'),
  partial: t('la última corrida quedó parcial'),
  failed: t('la última corrida falló'),
  running: t('hay una corrida en curso'),
  queued: t('hay una corrida en espera'),
};

export function netskopeSyncStatement(evidence: NetskopeSourceEvidence | null | undefined): { fresh: boolean; text: string } {
  if (!evidence) return { fresh: false, text: t('Sin información del sync de Netskope') };
  if (evidence.source_fresh) {
    return { fresh: true, text: evidence.source_completed_at ? t('Sincronizado {when}', { when: relativeTime(evidence.source_completed_at).toLowerCase() }) : t('Sincronizado') };
  }
  const reason = evidence.source_status ? (RUN_STATE[evidence.source_status] ?? t('la última corrida terminó como «{source_status}»', { source_status: evidence.source_status })) : t('no hay corridas de Netskope registradas');
  return { fresh: false, text: t('Sin sync vigente: {reason}', { reason: reason }) };
}


// One resource and one presentation for the client inventory; alert, DLP and
// UCI runs cannot certify its freshness. The backend owns the 24 h rule.
export const NETSKOPE_SYNC_PRESENTATION: SyncPresentationRegistration = {
  queryKey: ['netskope', 'sync-evidence'],
  readPermissions: ['netskope:read', 'access:manage'],
  async fetch(signal) {
    const { api } = await import('../../../cross/lib/api.ts');
    const evidence = await api<NetskopeSourceEvidence>('/cmdb/netskope/sync-evidence', { signal });
    return { text: netskopeSyncStatement(evidence).text, running: evidence.source_status === 'running', observedAt: evidence.source_fresh ? evidence.source_completed_at : null };
  },
};
