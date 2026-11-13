import type { SiaPolicyGranteeLink, SiaPolicyPersonResolution } from '../types/sia';
import { t } from '../../../cross/i18n/index.ts';

export type SiaGranteeLinkView = {
  value: string;
  sides: {
    source: 'identity' | 'pam';
    sourceLabel: string;
    status: 'matched' | 'ambiguous' | 'unmatched';
    statusLabel: string;
    displayName?: string;
  }[];
};

export type SiaGranteeLinkStatus = SiaPolicyPersonResolution['status'];
export type SiaGranteeLinkSource = 'identity' | 'pam';
export type SiaGranteeLinkFilters = {
  text: string;
  status: SiaGranteeLinkStatus | '';
  source: SiaGranteeLinkSource | '';
};

export type SiaGranteeLinkSummary = {
  recipients: number;
  sources: {
    source: SiaGranteeLinkSource;
    sourceLabel: string;
    matched: number;
    ambiguous: number;
    unmatched: number;
  }[];
};

const STATUS_LABELS: Record<SiaPolicyPersonResolution['status'], string> = {
  matched: t('Vinculado por correo'),
  ambiguous: t('Ambiguo: más de un candidato'),
  unmatched: t('Sin coincidencia'),
};

/** Human-readable exact-email results; an absent source stays absent. */
export function describeSiaGranteeLink(link: SiaPolicyGranteeLink): SiaGranteeLinkView {
  const sides: SiaGranteeLinkView['sides'] = [];
  for (const [source, sourceLabel] of [
    ['identity', 'Identity Administration'], ['pam', 'PAM'],
  ] as const) {
    const resolution = link[source];
    if (!resolution) continue;
    sides.push({
      source,
      sourceLabel,
      status: resolution.status,
      statusLabel: STATUS_LABELS[resolution.status],
      ...(resolution.status === 'matched' && resolution.match
        ? { displayName: resolution.match.display_name }
        : {}),
    });
  }
  return { value: link.value, sides };
}

/** Counts only source sides actually present in this policy's response. */
export function summarizeSiaGranteeLinks(links: SiaPolicyGranteeLink[]): SiaGranteeLinkSummary {
  const sources: SiaGranteeLinkSummary['sources'] = [];
  for (const [source, sourceLabel] of [
    ['identity', 'Identity Administration'], ['pam', 'PAM'],
  ] as const) {
    const present = links
      .map((link) => link[source]?.status)
      .filter((status): status is SiaGranteeLinkStatus => status !== undefined);
    if (!present.length) continue;
    sources.push({
      source,
      sourceLabel,
      matched: present.filter((status) => status === 'matched').length,
      ambiguous: present.filter((status) => status === 'ambiguous').length,
      unmatched: present.filter((status) => status === 'unmatched').length,
    });
  }
  return { recipients: links.length, sources };
}

/** Filters local SIA grantee results; a status matches either present side. */
export function filterSiaGranteeLinks(
  links: SiaPolicyGranteeLink[],
  filters: SiaGranteeLinkFilters,
): SiaPolicyGranteeLink[] {
  const text = filters.text.toLowerCase();
  return links.filter((link) => {
    if (text && !link.value.toLowerCase().includes(text)) return false;
    if (filters.source && !link[filters.source]) return false;
    if (filters.status) {
      const matchesStatus = filters.source
        ? link[filters.source]?.status === filters.status
        : link.identity?.status === filters.status || link.pam?.status === filters.status;
      if (!matchesStatus) return false;
    }
    return true;
  });
}
