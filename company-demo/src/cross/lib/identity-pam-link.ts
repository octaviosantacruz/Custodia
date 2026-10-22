import type { IdentityPamChain } from '../types/identity-pam-chain';

export type IdentityPamLinkView = {
  tone: 'success' | 'warning' | 'neutral';
  badge: string;
  heading: string;
  emptyCopy: string;
  statusLabel: string;
  originDescription: string;
};

const UUID_LINK_HEADING = 'Coincidencia por UUID de CyberArk Identity (mismo identificador en ambas fuentes), no por nombre.';
const EMAIL_LINK_HEADING = 'Vinculado por correo exacto 1 a 1 (misma dirección, sin UUID compartido), nunca por nombre ni similitud.';

/** Chain tooltip copy for the sanctioned Identity -> PAM bridge hops, keyed
 * by the backend's `basis` (`uuid_exact` / `email_exact`). Reuses the exact
 * wording identityPamLinkView shows in the drawer so the chain and the
 * drawer never describe the same hop with different language. */
export const IDENTITY_PAM_CHAIN_BASIS: Record<'uuid_exact' | 'email_exact', string> = {
  uuid_exact: UUID_LINK_HEADING,
  email_exact: EMAIL_LINK_HEADING,
};

/**
 * Single source of truth for how the Identity drawer labels the sanctioned
 * PAM link. The backend publishes match_basis (uuid | email | null) and
 * status (matched | ambiguous | unmatched); the UI must never claim "UUID
 * verificado" for a link that was actually resolved by exact email.
 */
export function identityPamLinkView(chain: IdentityPamChain | null): IdentityPamLinkView {
  const status = chain?.status ?? 'unmatched';
  const basis = chain?.match_basis ?? null;

  // A legacy payload without match_basis could only have matched by UUID.
  if (chain?.matched && (basis === 'uuid' || basis == null)) {
    return {
      tone: 'success',
      badge: 'UUID verificado',
      heading: UUID_LINK_HEADING,
      emptyCopy: '',
      statusLabel: 'UUID verificado',
      originDescription: 'UUID de Identity coincidente',
    };
  }
  if (chain?.matched && basis === 'email') {
    return {
      tone: 'success',
      badge: 'Vinculado por correo',
      heading: EMAIL_LINK_HEADING,
      emptyCopy: '',
      statusLabel: 'Vinculado por correo',
      originDescription: 'Correo exacto coincidente',
    };
  }
  if (status === 'ambiguous') {
    return {
      tone: 'warning',
      badge: 'Vínculo ambiguo',
      heading: 'Varios usuarios activos comparten ese correo exacto; no se dibuja ningún vínculo.',
      emptyCopy: 'Vínculo ambiguo: más de un usuario comparte el correo exacto en Identity o en PAM, así que no se muestra la cadena.',
      statusLabel: 'Vínculo ambiguo',
      originDescription: 'Correo exacto ambiguo',
    };
  }
  return {
    tone: 'neutral',
    badge: 'Sin vínculo',
    heading: 'Coincidencia por UUID de CyberArk Identity o correo exacto 1 a 1, nunca por nombre.',
    emptyCopy: 'Sin equivalencia en la cadena PAM: este usuario no comparte el UUID de CyberArk Identity ni un correo exacto 1 a 1 con ningún usuario PAM humano.',
    statusLabel: 'Sin vínculo',
    originDescription: 'Sin vínculo PAM',
  };
}
