import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ErrorState } from '../../components/ErrorState';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { useSession } from '../../hooks/useSession';

export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <LoadingSkeleton label="Checking your session" />;
  if (session.isError) {
    return <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
  }
  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
