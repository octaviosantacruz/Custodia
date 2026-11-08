import './role-group-links.css';
import { t } from '../i18n/index.ts';

/** These are configured mappings, not a live directory or observed membership. */
export function RoleGroupLinks({ groups }: { groups: string[] }) {
  if (!groups.length) return null;
  return <section className="role-group-links" aria-label={t('Grupos de Okta que otorgan este rol')}><h3>{t('Lo otorga en Okta')}</h3><ul>{groups.map((group) => <li key={group}>{group}</li>)}</ul><p>{t('Mapeo configurado. La pertenencia se informa al iniciar sesión.')}</p></section>;
}
