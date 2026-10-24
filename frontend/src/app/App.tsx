import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { LoginPage } from '../features/auth/LoginPage';
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
