import { apiFetch, ApiError } from './client';
import type { Meta, TimesheetWeek, User } from './types';

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
