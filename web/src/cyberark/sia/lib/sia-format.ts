/* Presentation helpers for the SIA tables. They only relabel or count what
   SIA reported; nothing here infers a value the payload does not carry. */

const OS_LABELS: Record<string, string> = { linux: 'Linux', windows: 'Windows', unix: 'Unix', macos: 'macOS' };
const ENGINE_LABELS: Record<string, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', onprem: 'On-premise', 'on-prem': 'On-premise' };

export function osLabel(value: string | undefined): string {
  if (!value) return '';
  return OS_LABELS[value.toLowerCase()] ?? value;
}

export function engineLabel(value: string | undefined): string {
  if (!value) return '';
  return ENGINE_LABELS[value.toLowerCase()] ?? value;
}

const DAY_MS = 86_400_000;

/** Whole days elapsed since an ISO timestamp, or null when it cannot be parsed. */
export function daysSince(value: string | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

export function ageLabel(days: number): string {
  if (days === 0) return 'hoy';
  if (days === 1) return 'hace 1 día';
  if (days < 60) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months < 24 ? `hace ${months} meses` : `hace ${Math.floor(days / 365)} años`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

export type PolicyTargetSummary = {
  ips: string[];
  fqdnCount: number;
  firstFqdn: string;
  logicalCount: number;
  firstLogical: string;
};

/** Counts the declared destinations of a SIA policy exactly as its rules list them. */
export function policyTargetSummary(attributes: { ip_rules?: unknown[]; fqdn_rules?: unknown[]; logical_names?: unknown[] }): PolicyTargetSummary {
  const ips: string[] = [];
  for (const rule of attributes.ip_rules ?? []) {
    if (typeof rule === 'string') ips.push(rule);
    else ips.push(...stringValues(recordValue(rule)?.ipAddresses));
  }
  const fqdnRules = attributes.fqdn_rules ?? [];
  const firstFqdnRule = fqdnRules[0];
  const fqdnRecord = recordValue(firstFqdnRule);
  const firstFqdn = typeof firstFqdnRule === 'string'
    ? firstFqdnRule
    : [fqdnRecord?.computernamePattern, fqdnRecord?.domain].filter((part): part is string => typeof part === 'string' && part.length > 0).join('.');
  const logicalNames = attributes.logical_names ?? [];
  const firstLogicalRule = logicalNames[0];
  const firstLogical = typeof firstLogicalRule === 'string' ? firstLogicalRule : String(recordValue(firstLogicalRule)?.logicalName ?? '');
  return { ips: [...new Set(ips)], fqdnCount: fqdnRules.length, firstFqdn, logicalCount: logicalNames.length, firstLogical };
}
