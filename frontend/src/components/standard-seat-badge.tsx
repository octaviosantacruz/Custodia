import { BadgeCheck } from 'lucide-react';

const PAM_TITLE = 'Asiento Standard conciliado: evidencia PAM de EPVUser y rol Privilege Cloud; no es facturación.';
const IDENTITY_TITLE = 'Asiento Standard conciliado: el UUID de Identity coincide con un usuario PAM EPVUser en un rol Privilege Cloud. No es facturación ni un dato SCIM.';

type StandardSeatBadgeProps = {
  reconciled?: boolean;
  context?: 'pam' | 'identity';
};

export function StandardSeatBadge({ reconciled = false, context = 'pam' }: StandardSeatBadgeProps) {
  if (!reconciled) return null;
  return (
    <span
      className="standard-seat-badge"
      aria-label="Asiento Standard conciliado"
      title={context === 'identity' ? IDENTITY_TITLE : PAM_TITLE}
    >
      <BadgeCheck size={16} aria-hidden />
      <span aria-hidden>Licencia Standard</span>
    </span>
  );
}
