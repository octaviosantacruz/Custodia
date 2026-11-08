import { useQuery } from '@tanstack/react-query';
import { fetchIdentityRoleMatches } from '../lib/identity-admin-api';
import { usePamRefreshKey } from '../../shared/refresh-context';

export function useIdentityRoleMatches(enabled: boolean) {
  const refreshKey = usePamRefreshKey();
  return useQuery({
    queryKey: ['identity-role-member-matches', refreshKey],
    queryFn: ({ signal }) => fetchIdentityRoleMatches(signal),
    enabled,
  });
}
