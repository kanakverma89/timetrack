import { useQuery } from '@tanstack/react-query';
import { fetchApprovals } from '../api/endpoints';
import type { Role } from '../api/types';

export const canReview = (role: Role | undefined) => role === 'MANAGER' || role === 'ADMIN';

/** How many submitted weeks wait for this reviewer (null for people who cannot review). */
export function usePendingApprovals(role: Role | undefined) {
  const enabled = canReview(role);
  const query = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: () => fetchApprovals({ status: 'SUBMITTED', page: 1, pageSize: 1 }),
    enabled,
    staleTime: 30_000,
  });
  return enabled ? (query.data?.total ?? null) : null;
}
