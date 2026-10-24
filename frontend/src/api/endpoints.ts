import { apiFetch, ApiError } from './client';
import type {
  AdminEarningCode,
  AdminProject,
  AdminTask,
  AdminUser,
  ApprovalDetail,
  ApprovalList,
  AuditItem,
  BatchResult,
  Classification,
  ConfigEntity,
  EarningCodeOption,
  EntryInput,
  GroupBy,
  HoursReport,
  Meta,
  Paged,
  Policy,
  PolicyInput,
  ProjectOption,
  Role,
  TaskOption,
  Team,
  TeamDetail,
  TimeEntry,
  TimesheetWeek,
  User,
  UserCreateInput,
  UserUpdateInput,
  UserWithTemporaryPassword,
  WeekStatus,
} from './types';

export async function login(email: string, password: string): Promise<User> {
  return apiFetch<User>('/auth/login', { method: 'POST', body: { email, password } });
}

export async function logout(): Promise<void> {
  await apiFetch<void>('/auth/logout', { method: 'POST' });
}

/** The signed-in user, or null when there is no valid session. */
export async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await apiFetch<User>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const fetchMeta = () => apiFetch<Meta>('/meta');

export const fetchWeek = (weekStart: string, signal?: AbortSignal) =>
  apiFetch<TimesheetWeek>(`/timesheets/weeks/${encodeURIComponent(weekStart)}`, { signal });

export const fetchProjects = async () =>
  (await apiFetch<{ items: ProjectOption[] }>('/projects?active=true')).items;

export const fetchTasks = async (projectId: string) =>
  (
    await apiFetch<{ items: TaskOption[] }>(
      `/projects/${encodeURIComponent(projectId)}/tasks?active=true`,
    )
  ).items;

export const fetchEarningCodes = async () =>
  (await apiFetch<{ items: EarningCodeOption[] }>('/earning-codes?active=true')).items;

export const createEntry = (input: EntryInput) =>
  apiFetch<TimeEntry>('/time-entries', { method: 'POST', body: input });

/** `version` makes the update fail with 409 if the entry changed since it was loaded. */
export const updateEntry = (id: string, input: EntryInput, version: number) =>
  apiFetch<TimeEntry>(`/time-entries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input, version },
  });

export const deleteEntry = (id: string) =>
  apiFetch<void>(`/time-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Week mode: all entries are created in one transaction or none are. */
export const createEntriesBatch = (entries: EntryInput[]) =>
  apiFetch<BatchResult>('/time-entries/batch', { method: 'POST', body: { entries } });

/**
 * Submit the week for approval. The idempotency key lets a retry (double click, flaky network)
 * return the result of the first attempt instead of failing as a duplicate.
 */
export const submitWeek = (weekStart: string, comment: string | null, idempotencyKey: string) =>
  apiFetch<TimesheetWeek>(`/timesheets/weeks/${encodeURIComponent(weekStart)}/submit`, {
    method: 'POST',
    body: { comment },
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export interface ApprovalQuery {
  status: Exclude<WeekStatus, 'DRAFT'>;
  page: number;
  pageSize: number;
  /** Any date inside the week to filter by; omitted for all weeks. */
  week?: string;
}

export const fetchApprovals = ({ status, page, pageSize, week }: ApprovalQuery) => {
  const params = new URLSearchParams({ status, page: String(page), page_size: String(pageSize) });
  if (week) params.set('week_start_date', week);
  return apiFetch<ApprovalList>(`/approvals?${params.toString()}`);
};

export const fetchApproval = (weekId: string) =>
  apiFetch<ApprovalDetail>(`/approvals/${encodeURIComponent(weekId)}`);

export const approveWeek = (weekId: string, comment: string | null, idempotencyKey: string) =>
  apiFetch<ApprovalDetail>(`/approvals/${encodeURIComponent(weekId)}/approve`, {
    method: 'POST',
    body: { comment },
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const rejectWeek = (weekId: string, reason: string, idempotencyKey: string) =>
  apiFetch<ApprovalDetail>(`/approvals/${encodeURIComponent(weekId)}/reject`, {
    method: 'POST',
    body: { comment: reason },
    headers: { 'Idempotency-Key': idempotencyKey },
  });

// ---- account ---------------------------------------------------------------------------

/** Ends every other session of the account; the current one stays signed in. */
export const changePassword = (currentPassword: string, newPassword: string) =>
  apiFetch<void>('/auth/change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  });

// ---- administration (administrators only) -----------------------------------------------

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const id = encodeURIComponent;

export interface UserQuery {
  search?: string;
  role?: Role | '';
  active?: boolean;
  managersOnly?: boolean;
  page: number;
  pageSize: number;
}

export const fetchAdminUsers = (q: UserQuery) =>
  apiFetch<Paged<AdminUser>>(
    `/admin/users${query({
      search: q.search,
      role: q.role,
      active: q.active,
      managers_only: q.managersOnly,
      page: q.page,
      page_size: q.pageSize,
    })}`,
  );

export const createAdminUser = (input: UserCreateInput) =>
  apiFetch<UserWithTemporaryPassword>('/admin/users', { method: 'POST', body: input });

export const updateAdminUser = (userId: string, input: UserUpdateInput) =>
  apiFetch<AdminUser>(`/admin/users/${id(userId)}`, { method: 'PATCH', body: input });

export const resetUserPassword = (userId: string) =>
  apiFetch<{ temporary_password: string }>(`/admin/users/${id(userId)}/reset-password`, {
    method: 'POST',
  });

export const fetchTeams = async () => (await apiFetch<{ items: Team[] }>('/admin/teams')).items;
export const fetchTeam = (teamId: string) => apiFetch<TeamDetail>(`/admin/teams/${id(teamId)}`);
export const createTeam = (name: string) =>
  apiFetch<TeamDetail>('/admin/teams', { method: 'POST', body: { name } });
export const renameTeam = (teamId: string, name: string) =>
  apiFetch<TeamDetail>(`/admin/teams/${id(teamId)}`, { method: 'PATCH', body: { name } });
export const setTeamMembers = (teamId: string, userIds: string[]) =>
  apiFetch<TeamDetail>(`/admin/teams/${id(teamId)}/members`, {
    method: 'PUT',
    body: { user_ids: userIds },
  });
export const deleteTeam = (teamId: string) =>
  apiFetch<void>(`/admin/teams/${id(teamId)}`, { method: 'DELETE' });

export interface ProjectQuery {
  search?: string;
  active?: boolean;
  page: number;
  pageSize: number;
}

export const fetchAdminProjects = (q: ProjectQuery) =>
  apiFetch<Paged<AdminProject>>(
    `/admin/projects${query({
      search: q.search,
      active: q.active,
      page: q.page,
      page_size: q.pageSize,
    })}`,
  );
export const fetchAdminProject = (projectId: string) =>
  apiFetch<AdminProject>(`/admin/projects/${id(projectId)}`);
export const createProject = (input: { code: string; name: string; description: string | null }) =>
  apiFetch<AdminProject>('/admin/projects', { method: 'POST', body: input });
export const updateProject = (
  projectId: string,
  input: Partial<{ name: string; description: string | null; is_active: boolean }>,
) => apiFetch<AdminProject>(`/admin/projects/${id(projectId)}`, { method: 'PATCH', body: input });

export const fetchAdminTasks = async (projectId: string) =>
  (await apiFetch<{ items: AdminTask[] }>(`/admin/projects/${id(projectId)}/tasks`)).items;
export const createTask = (projectId: string, input: { code: string; name: string }) =>
  apiFetch<AdminTask>(`/admin/projects/${id(projectId)}/tasks`, { method: 'POST', body: input });
export const updateTask = (taskId: string, input: Partial<{ name: string; is_active: boolean }>) =>
  apiFetch<AdminTask>(`/admin/tasks/${id(taskId)}`, { method: 'PATCH', body: input });

export const fetchAdminEarningCodes = async () =>
  (await apiFetch<{ items: AdminEarningCode[] }>('/admin/earning-codes')).items;
export const createEarningCode = (input: {
  code: string;
  name: string;
  classification: Classification;
}) => apiFetch<AdminEarningCode>('/admin/earning-codes', { method: 'POST', body: input });
export const updateEarningCode = (
  codeId: string,
  input: Partial<{ name: string; classification: Classification; is_active: boolean }>,
) =>
  apiFetch<AdminEarningCode>(`/admin/earning-codes/${id(codeId)}`, {
    method: 'PATCH',
    body: input,
  });

export const fetchPolicy = () => apiFetch<Policy>('/admin/policy');
export const savePolicy = (input: PolicyInput) =>
  apiFetch<Policy>('/admin/policy', { method: 'PUT', body: input });
export const resetPolicy = () => apiFetch<Policy>('/admin/policy', { method: 'DELETE' });

export const fetchAudit = (q: { entityType?: ConfigEntity | ''; page: number; pageSize: number }) =>
  apiFetch<Paged<AuditItem>>(
    `/admin/audit${query({ entity_type: q.entityType, page: q.page, page_size: q.pageSize })}`,
  );

// ---- reports (managers and administrators) ----------------------------------------------

export interface ReportQuery {
  dateFrom: string;
  dateTo: string;
  groupBy: GroupBy;
  statuses: WeekStatus[];
}

function reportParams(q: ReportQuery): URLSearchParams {
  const params = new URLSearchParams({
    date_from: q.dateFrom,
    date_to: q.dateTo,
    group_by: q.groupBy,
  });
  for (const status of q.statuses) params.append('status', status);
  return params;
}

export const fetchHoursReport = (q: ReportQuery & { page: number; pageSize: number }) => {
  const params = reportParams(q);
  params.set('page', String(q.page));
  params.set('page_size', String(q.pageSize));
  return apiFetch<HoursReport>(`/reports/hours?${params.toString()}`);
};

/** A plain same-origin link: the browser sends the session cookie and downloads the file. */
export const hoursCsvUrl = (q: ReportQuery) =>
  `${(import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')}/reports/hours.csv?${reportParams(q).toString()}`;
