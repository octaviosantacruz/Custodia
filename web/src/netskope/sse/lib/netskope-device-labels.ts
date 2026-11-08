import { t } from '../../../cross/i18n/index.ts';
const MAKE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'hewlett packard': ['hp'],
  'hewlett-packard': ['hp'],
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
}

/** Keeps the original manufacturer and model readable without repeating a
 * brand that the model string already contains (including HP's full name). */
export function deviceMakeModelLabel(make: string | null | undefined, model: string | null | undefined): string {
  const manufacturer = make?.trim() ?? '';
  const product = model?.trim() ?? '';
  if (!manufacturer) return product;
  if (!product) return manufacturer;

  const productKey = normalized(product);
  const manufacturerKeys = [normalized(manufacturer), ...(MAKE_ALIASES[normalized(manufacturer)] ?? [])];
  if (manufacturerKeys.some((key) => productKey === key || productKey.startsWith(`${key} `))) return product;
  return `${manufacturer} ${product}`;
}

/** How Custodia reads the client's last signal; the colour dot in the inventory carries the same state. */
export const DEVICE_EVIDENCE_LABELS: Record<'recent' | 'not_recent' | 'review' | 'unknown', string> = {
  recent: t('Señal reciente'),
  not_recent: t('Sin señal reciente'),
  review: t('Candidato a revisión'),
  unknown: t('Sin evidencia vigente'),
};
