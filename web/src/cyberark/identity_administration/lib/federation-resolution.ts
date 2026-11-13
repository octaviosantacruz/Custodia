/* IDENTITY_SIA_CONSOLIDATION_PLAN_2026-09-12.md §3.1/§7: copy and visual
   tone for each explicit federation_resolution state. Kept as pure
   functions (no JSX) so the mapping itself is unit-testable without
   mounting IdentityAdminWorkspace/IdentityDrawer. The federation is always
   presented as a *derived* association -- never as evidence the API
   delivered -- so no label here should imply the federation "contains"
   the user. */
import type { FederationResolution } from '../types/identity';
import { t } from '../../../cross/i18n/index.ts';

export type FederationBadgeTone = 'success' | 'warning' | 'neutral';

export function federationBadgeLabel(resolution: FederationResolution | null | undefined): string {
  if (!resolution) return t('Sin regla de federación');
  switch (resolution.status) {
    case 'matched':
      return resolution.expected_name || resolution.display_name || t('Federación esperada');
    case 'missing_federation':
      return 'Esperada, no sincronizada';
    case 'unsupported_domain':
      return t('Sin regla');
    case 'missing_email':
      return '—';
    case 'ambiguous':
      return t('Más de una federación coincide');
    default:
      return t('Sin regla de federación');
  }
}

export function federationBadgeTone(resolution: FederationResolution | null | undefined): FederationBadgeTone {
  if (!resolution) return 'neutral';
  switch (resolution.status) {
    case 'matched':
      return 'success';
    case 'missing_federation':
    case 'ambiguous':
      return 'warning';
    case 'unsupported_domain':
    case 'missing_email':
    default:
      return 'neutral';
  }
}

/** Chain tooltip copy for the derived federation hop (basis
 * `email_domain_rule`); same criterion as the drawer's "Derivada por
 * dominio" chip, never phrased as evidence delivered by the API. */
export const FEDERATION_DERIVED_DESCRIPTION = t('Derivada por regla de dominio de correo; no es una relación entregada por la API de Identity Administration.');

/* Longer, unambiguous copy for the identity drawer -- the row badge stays
   compact, but the drawer must never let a user read this as "the
   federation contains me". */
export function federationDrawerSummary(resolution: FederationResolution | null | undefined): string {
  if (!resolution) return t('Sin regla de federación esperada por dominio de correo.');
  switch (resolution.status) {
    case 'matched':
      return `Federación esperada por dominio de correo: ${resolution.expected_name || resolution.display_name}.`;
    case 'missing_federation':
      return `Se espera ${resolution.expected_name} por dominio de correo, pero no está sincronizada todavía.`;
    case 'unsupported_domain':
      return t('El dominio de este correo no tiene una regla de federación definida.');
    case 'missing_email':
      return t('No hay un email utilizable para derivar la federación esperada.');
    case 'ambiguous':
      return t('Más de una federación activa coincide con {expected_name}; no se elige una automáticamente.', { expected_name: resolution.expected_name });
    default:
      return t('Sin regla de federación esperada por dominio de correo.');
  }
}
