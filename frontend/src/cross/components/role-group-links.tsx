import './role-group-links.css';

/** These are configured mappings, not a live directory or observed membership. */
export function RoleGroupLinks({ groups }: { groups: string[] }) {
  if (!groups.length) return null;
  return <section className="role-group-links" aria-label="Grupos de Okta que otorgan este rol"><h3>Lo otorga en Okta</h3><ul>{groups.map((group) => <li key={group}>{group}</li>)}</ul><p>Mapeo configurado. La pertenencia se informa al iniciar sesión.</p></section>;
}
