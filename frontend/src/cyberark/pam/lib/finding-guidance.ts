import type { Finding } from '../types/findings';

export type FindingGuidance = {
  observation: string;
  impact: string;
  action: string;
  actionShort: string;
};

const GUIDANCE: Record<string, FindingGuidance> = {
  SAFE_NO_ACTIVE_ACCOUNTS: {
    observation: 'El inventario no encontró cuentas activas dentro de este Safe.',
    impact: 'Puede ser un Safe vacío, retirado o pendiente de sincronización. Por sí solo no implica un incumplimiento.',
    action: 'Abrí el Safe y confirmá si debe conservarse. Si la fuente cambió, actualizá las reglas después de la próxima sincronización.',
    actionShort: 'Validar si el Safe sigue vigente',
  },
  ACCOUNT_PLATFORM_MISSING: {
    observation: 'La cuenta llegó sin identificador ni nombre de plataforma.',
    impact: 'Sin esa relación no se puede interpretar correctamente cómo se administra la cuenta.',
    action: 'Abrí el Safe relacionado y revisá la plataforma de la cuenta en la fuente. Luego sincronizá el inventario.',
    actionShort: 'Completar plataforma en la fuente',
  },
  ACCOUNT_PLATFORM_PARTIAL: {
    observation: 'La cuenta tiene solo una parte de la referencia de plataforma: identificador o nombre.',
    impact: 'La relación puede mostrarse de forma incompleta y afectar análisis que agrupan cuentas por plataforma.',
    action: 'Compará el identificador y el nombre de plataforma en la fuente y corregí el campo faltante antes de sincronizar.',
    actionShort: 'Completar referencia de plataforma',
  },
};

const FALLBACK: FindingGuidance = {
  observation: 'El inventario detectó una condición que requiere revisión.',
  impact: 'Revisá la evidencia antes de decidir si corresponde corregirla o documentar una excepción.',
  action: 'Validá el objeto en la fuente y actualizá las reglas después del próximo inventario.',
  actionShort: 'Revisar evidencia en la fuente',
};

export function findingGuidance(finding: Pick<Finding, 'rule_id'>): FindingGuidance {
  return GUIDANCE[finding.rule_id] || FALLBACK;
}
