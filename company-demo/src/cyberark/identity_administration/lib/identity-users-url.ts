/* FE-AUD-008: the Usuarios list criteria that travel in the URL so a reload or a shared link keeps the review context.
   Only allowlisted values are read back; anything else is ignored. */
export type IdentityUsersCriteria = {
  search: string;
  active: 'active' | 'inactive' | '';
  standardSeat: 'reconciled' | 'unreconciled' | '';
};

export const EMPTY_IDENTITY_USERS_CRITERIA: IdentityUsersCriteria = { search: '', active: '', standardSeat: '' };

export function identityUsersCriteriaFromSearch(queryString: string): IdentityUsersCriteria | null {
  const params = new URLSearchParams(queryString);
  const search = (params.get('q') ?? '').slice(0, 160);
  const active = params.get('active');
  const seat = params.get('seat');
  const criteria: IdentityUsersCriteria = {
    search,
    active: active === 'active' || active === 'inactive' ? active : '',
    standardSeat: seat === 'reconciled' || seat === 'unreconciled' ? seat : '',
  };
  return criteria.search || criteria.active || criteria.standardSeat ? criteria : null;
}

export function identityUsersQueryString(criteria: IdentityUsersCriteria): string {
  const params = new URLSearchParams();
  if (criteria.search.trim()) params.set('q', criteria.search.trim());
  if (criteria.active) params.set('active', criteria.active);
  if (criteria.standardSeat) params.set('seat', criteria.standardSeat);
  return params.toString();
}
