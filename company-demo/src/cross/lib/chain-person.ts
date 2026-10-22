import type { components } from './chains-api.generated';

type ChainIdentity = components['schemas']['ChainIdentity'];
export type PersonFields = { account?: { label: string; sublabel: string } };

/** Relaciones shows the person and their PAM account as one node. The node keeps
 * the PAM `id`; its `label`/`sublabel` become the person and the account the
 * card was built from moves inside as `account`. */
export function withPerson<T extends { type: string; label: string; sublabel: string; identity?: ChainIdentity | null } & PersonFields>(item: T): T {
  if (item.type !== 'user' || !item.identity) return item;
  return {
    ...item,
    label: item.identity.display_name,
    sublabel: item.identity.email,
    account: { label: item.label, sublabel: item.sublabel },
  };
}
