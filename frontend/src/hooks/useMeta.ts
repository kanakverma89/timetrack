import { useQuery } from '@tanstack/react-query';
import { fetchMeta } from '../api/endpoints';

/** Business configuration and the server's "today"; shared by every page that shows dates/times. */
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: 5 * 60_000 });
}
