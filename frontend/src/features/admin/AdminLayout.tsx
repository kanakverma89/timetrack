import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const SECTIONS: Array<[string, string]> = [
  ['/admin/users', 'Users'],
  ['/admin/teams', 'Teams'],
  ['/admin/projects', 'Projects'],
  ['/admin/earning-codes', 'Earning codes'],
  ['/admin/policy', 'Policy'],
  ['/admin/audit', 'Audit log'],
];

export function AdminLayout() {
  useEffect(() => {
    document.title = 'Administration · TimeTrack';
  }, []);
  return (
    <div className="admin">
      <h1>Administration</h1>
      <nav className="sub-nav" aria-label="Administration">
        {SECTIONS.map(([to, label]) => (
          <NavLink key={to} to={to}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
