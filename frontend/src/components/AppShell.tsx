import { Link, NavLink, useNavigate } from 'react-router-dom';
import { canReview, usePendingApprovals } from '../hooks/usePendingApprovals';
import { useLogout, useSession } from '../hooks/useSession';
import type { ReactNode } from 'react';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export function AppShell({ appName, children }: { appName: string; children: ReactNode }) {
  const { data: user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  // While a temporary password is pending the API refuses everything else; do not even try.
  const locked = user?.must_change_password === true;
  const pending = usePendingApprovals(locked ? undefined : user?.role);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <span className="brand">
            <svg aria-hidden="true" viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <circle cx="16" cy="16" r="9" fill="none" stroke="#fff" strokeWidth="2.5" />
              <path
                d="M16 10v6l4 2.5"
                fill="none"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {appName}
          </span>
          {user && !locked ? (
            <nav className="main-nav" aria-label="Main">
              <NavLink to="/" end>
                Timesheet
              </NavLink>
              {canReview(user.role) ? (
                <NavLink
                  to="/approvals"
                  // An explicit name: whitespace between inline pieces is not a reliable separator.
                  aria-label={pending ? `Approvals ${pending} waiting for review` : undefined}
                >
                  Approvals {pending ? <span className="count-badge">{pending}</span> : null}
                </NavLink>
              ) : null}
              {canReview(user.role) ? <NavLink to="/reports">Reports</NavLink> : null}
              {user.role === 'ADMIN' ? <NavLink to="/admin">Admin</NavLink> : null}
            </nav>
          ) : null}
          {user ? (
            <div className="user-menu">
              <span className="avatar" aria-hidden="true">
                {initials(user.display_name)}
              </span>
              <span className="user-name">
                {user.display_name}
                <span className="muted small"> · {user.role.toLowerCase()}</span>
              </span>
              {locked ? null : (
                <Link className="btn btn-link" to="/account/password">
                  Change password
                </Link>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={logout.isPending}
                onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login') })}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="main">
        {children}
      </main>
    </div>
  );
}
