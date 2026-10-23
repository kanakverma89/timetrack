import { useNavigate } from 'react-router-dom';
import { useLogout, useSession } from '../hooks/useSession';
import type { ReactNode } from 'react';

export function AppShell({ appName, children }: { appName: string; children: ReactNode }) {
  const { data: user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

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
          {user ? (
            <div className="user-menu">
              <span className="user-name">
                {user.display_name}
                <span className="muted small"> · {user.role.toLowerCase()}</span>
              </span>
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
