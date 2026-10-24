import type { AdminUser } from '../api/types';
import { META, ADMIN } from './fixtures';
import { mockApi } from './mockApi';

export const person = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u-lee',
  email: 'lee@example.test',
  display_name: 'Lee Leaver',
  role: 'EMPLOYEE',
  is_active: true,
  manager: null,
  report_count: 0,
  must_change_password: false,
  created_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

export const MORGAN = {
  id: 'u-morgan',
  display_name: 'Morgan Manager',
  email: 'manager@example.test',
};

export const paged = <T>(items: T[], total = items.length, page = 1, pageSize = 20) => ({
  items,
  page,
  page_size: pageSize,
  total,
});

type Routes = Parameters<typeof mockApi>[0];

/** A signed-in administrator with the calls every page makes; add the page's own routes. */
export function adminApi(extra: Routes = {}) {
  return mockApi({
    'GET /auth/me': () => ({ body: ADMIN }),
    'GET /meta': () => ({ body: META }),
    'GET /approvals': () => ({ body: paged([], 0, 1, 1) }),
    ...extra,
  });
}

export const bodyOf = (init: RequestInit) =>
  JSON.parse(String(init.body)) as Record<string, unknown>;

export function fieldError(field: string, message: string, status = 422) {
  return {
    status,
    body: {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        field_errors: { [field]: message },
        request_id: 'req-test-0001',
      },
    },
  };
}
