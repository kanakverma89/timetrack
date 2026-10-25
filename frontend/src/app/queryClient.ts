import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';

export const SESSION_KEY = ['me'] as const;
export const SESSION_EXPIRED_KEY = ['sessionExpired'] as const;
/** Set when the person chose to sign out, so the next sign-in does not resume where they left. */
export const SIGNED_OUT_KEY = ['signedOut'] as const;

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Any 401 on a data request means the session ended: send the user back to sign in.
        if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== 'me') {
          client.setQueryData(SESSION_EXPIRED_KEY, true);
          client.setQueryData(SESSION_KEY, null);
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry transient failures only; 4xx responses will not change on retry.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
          failureCount < 2,
      },
    },
  });
  return client;
}
