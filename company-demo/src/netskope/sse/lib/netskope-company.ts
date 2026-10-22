export function companyFromIdentity(value: string | null | undefined, declared?: string | number | boolean | null): string {
  if (typeof declared === 'string' && declared.trim()) return declared.trim();
  // Legacy display fallback only; never an identity or company join rule.
  const identity = (value || '').trim().toLowerCase();
  const at = identity.lastIndexOf('@');
  if (at < 0) return 'Sin empresa';
  const domain = identity.slice(at + 1).replace(/\.$/, '');
  const name = domain.split('.')[0]?.trim();
  return name ? name.toUpperCase() : 'Sin empresa';
}
