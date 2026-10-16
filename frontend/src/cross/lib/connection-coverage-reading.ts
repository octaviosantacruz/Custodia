import type { CapabilityResult, PolicyCapability } from '../types/connection';

export type ReadingTone = 'success' | 'warning' | 'danger' | 'neutral';
export type Reading = { label: string; tone: ReadingTone; hint: string };

export const FLAG_FIELDS = [
  { field: 'ca_sia', label: 'Platform', short: 'Platform' },
  { field: 'ca_dba', label: 'DBA', short: 'DBA' },
  { field: 'zsp_implemented', label: 'ZSP', short: 'ZSP' },
  { field: 'access_available', label: 'Acceso', short: 'Acceso' },
] as const;

const CAPABILITY_NAMES = { platform: 'Platform', dba: 'DBA' } as const;
export type ReadableCapability = keyof typeof CAPABILITY_NAMES;

/** The server's reading of one capability: the sheet's flag against the SIA policies a person classified for it. */
export function capabilityReading(capability: ReadableCapability, result: CapabilityResult | null): Reading | null {
  const name = CAPABILITY_NAMES[capability];
  switch (result) {
    case 'match': return { label: 'Coincide', tone: 'success', hint: `Lo declarado para ${name} coincide con SIA.` };
    case 'missing': return { label: 'Falta en SIA', tone: 'danger', hint: `La planilla declara ${name} y ninguna política SIA clasificada como ${name} tiene esta IP.` };
    case 'undeclared': return { label: 'No declarado', tone: 'warning', hint: `Una política SIA de ${name} tiene esta IP y la planilla no lo declara.` };
    case 'unclassified': return { label: 'Sin clasificar', tone: 'neutral', hint: 'Hay políticas SIA con esta IP que todavía no están clasificadas.' };
    case 'unknown': return { label: 'Sin dato', tone: 'neutral', hint: `La planilla no dice si usa ${name} y SIA no lo muestra.` };
    default: return null;
  }
}

export function isDeviation(result: CapabilityResult | null): boolean {
  return result === 'missing' || result === 'undeclared';
}

export const POLICY_CAPABILITY_LABELS: Record<PolicyCapability, string> = { platform: 'Platform', dba: 'DBA', other: 'Otra' };

export function flagLabel(value: boolean | null): string {
  return value === true ? 'Sí' : value === false ? 'No' : 'Sin dato';
}

export function flagTone(value: boolean | null): ReadingTone {
  return value === true ? 'success' : value === false ? 'danger' : 'neutral';
}

/** One click moves a flag along Sin dato -> Sí -> No -> Sin dato. */
export function nextFlag(value: boolean | null): boolean | null {
  return value === null ? true : value === true ? false : null;
}
