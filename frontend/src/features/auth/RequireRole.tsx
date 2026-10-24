import { Link, Outlet } from 'react-router-dom';
import type { Role } from '../../api/types';
import { useSession } from '../../hooks/useSession';

/** Client-side courtesy only: the API refuses these routes to other roles regardless. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { data: user } = useSession();
  if (user && roles.includes(user.role)) return <Outlet />;
  return (
    <div className="empty-state" role="alert">
      <h1>You do not have access to this page</h1>
      <p>Your account is not allowed to review timesheets.</p>
      <p>
        <Link to="/">Back to your timesheet</Link>
      </p>
    </div>
  );
}
