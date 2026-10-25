import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { AdminLayout } from '../features/admin/AdminLayout';
import { AuditPage } from '../features/admin/AuditPage';
import { EarningCodesPage } from '../features/admin/EarningCodesPage';
import { PolicyPage } from '../features/admin/PolicyPage';
import { ProjectsPage } from '../features/admin/ProjectsPage';
import { ProjectTasksPage } from '../features/admin/ProjectTasksPage';
import { TeamsPage } from '../features/admin/TeamsPage';
import { UsersPage } from '../features/admin/UsersPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { ApprovalsPage } from '../features/approvals/ApprovalsPage';
import { ReviewPage } from '../features/approvals/ReviewPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequireRole } from '../features/auth/RequireRole';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { createQueryClient } from './queryClient';

const APP_NAME = 'TimeTrack';

export function App({ client }: { client?: QueryClient }) {
  const queryClient = useMemo(() => client ?? createQueryClient(), [client]);
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/login" element={<LoginPage appName={APP_NAME} />} />
        <Route
          element={
            <AppShell appName={APP_NAME}>
              <RequireAuth />
            </AppShell>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route element={<RequireRole roles={['MANAGER', 'ADMIN']} />}>
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/approvals/:weekId" element={<ReviewPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Route>
          <Route path="/account/password" element={<ChangePasswordPage />} />
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="teams" element={<TeamsPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:projectId" element={<ProjectTasksPage />} />
              <Route path="earning-codes" element={<EarningCodesPage />} />
              <Route path="policy" element={<PolicyPage />} />
              <Route path="audit" element={<AuditPage />} />
            </Route>
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <AppShell appName={APP_NAME}>
              <h1>Page not found</h1>
              <p>
                <a href="/">Back to the timesheet</a>
              </p>
            </AppShell>
          }
        />
      </Routes>
    </QueryClientProvider>
  );
}
