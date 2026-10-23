import { apiFetch, ApiError } from './client';
import type {
  EarningCodeOption,
  EntryInput,
  Meta,
  ProjectOption,
  TaskOption,
  TimeEntry,
  TimesheetWeek,
  User,
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
