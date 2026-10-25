import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCurrentUser, login, logout } from '../api/endpoints';
import { SESSION_EXPIRED_KEY, SESSION_KEY, SIGNED_OUT_KEY } from '../app/queryClient';

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchCurrentUser,
    staleTime: Infinity,
    retry: false,
  });
}

/** Drop every cached query except the session, so one user's data is never shown to another. */
function clearUserData(client: ReturnType<typeof useQueryClient>) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: (user) => {
      clearUserData(client);
      client.removeQueries({ queryKey: SESSION_EXPIRED_KEY });
      client.setQueryData(SESSION_KEY, user);
    },
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      clearUserData(client);
      // Must be set before the session is cleared: clearing it makes the protected page redirect
      // to sign-in, and that redirect reads this flag to decide whether to remember the page.
      client.setQueryData(SIGNED_OUT_KEY, true);
      client.setQueryData(SESSION_KEY, null);
    },
  });
}
