export function companyFromIdentity(value: string | null | undefined): string {
  const identity = (value || '').trim().toLowerCase();
  const at = identity.lastIndexOf('@');
  if (at < 0) return t('Sin empresa');
  const domain = identity.slice(at + 1).replace(/\.$/, '');
  const name = domain.split('.')[0]?.trim();
  return name ? name.toUpperCase() : t('Sin empresa');
}

import { t } from '../../../cross/i18n/index.ts';