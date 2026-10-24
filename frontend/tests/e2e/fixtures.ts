import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test';

export const EMPLOYEE = 'employee@example.test';
export const EMPLOYEE2 = 'employee2@example.test';
export const EMPLOYEE3 = 'employee3@example.test'; // reports to MANAGER2, not MANAGER
export const MANAGER = 'manager@example.test'; // Morgan: manages EMPLOYEE and EMPLOYEE2
export const MANAGER2 = 'manager2@example.test'; // Riley: manages EMPLOYEE3 only
export const ADMIN = 'admin@example.test';
export const PASSWORD = process.env.SEED_PASSWORD ?? '';

export const API = '/api/v1';
export const CSRF = { 'X-Requested-With': 'timetrack' };

/** Sign in through the API; the session cookie is shared with the page's browser context. */
export async function signInViaApi(request: APIRequestContext, email: string) {
  const response = await request.post(`${API}/auth/login`, {
    headers: CSRF,
    data: { email, password: PASSWORD },
  });
  expect(response.ok(), `login for ${email} failed with ${response.status()}`).toBe(true);
}

export async function openWeek(page: Page, week: string) {
  await page.goto(`/?week=${week}`);
}

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`);
  expect(summary, 'accessibility violations').toEqual([]);
}

/** A page in its own browser context, signed in as `email` (a genuinely separate session). */
async function pageFor(browser: Browser, baseURL: string | undefined, email: string) {
  const context = await browser.newContext({ baseURL });
  await signInViaApi(context.request, email);
  return { page: await context.newPage(), close: () => context.close() };
}

export const test = base.extend<{
  employeePage: Page;
  managerPage: Page;
  manager2Page: Page;
  adminPage: Page;
}>({
  employeePage: async ({ page }, use) => {
    await signInViaApi(page.request, EMPLOYEE);
    await use(page);
  },
  managerPage: async ({ browser, baseURL }, use) => {
    const { page, close } = await pageFor(browser, baseURL, MANAGER);
    await use(page);
    await close();
  },
  manager2Page: async ({ browser, baseURL }, use) => {
    const { page, close } = await pageFor(browser, baseURL, MANAGER2);
    await use(page);
    await close();
  },
  adminPage: async ({ browser, baseURL }, use) => {
    const { page, close } = await pageFor(browser, baseURL, ADMIN);
    await use(page);
    await close();
  },
});
export { expect };

// ---- isolation for tests that write data -------------------------------------------------
// Every mutating test owns one far-future week. The week is derived from the test's key and the
// browser project, so two tests can never share a week (and parallel browsers cannot collide).

export const WEEK_KEYS = [
  'open-panel',
  'validation',
  'project-task',
  'create',
  'persist',
  'edit',
  'cancel-warning',
  'delete',
  'totals-match',
  'keyboard',
  'a11y-panel',
  'mobile',
  'double-click',
  'stale-edit',
  'ownership',
  'hours-limit',
  'focus-trap',
  'description-text',
  'week-create',
  'week-atomic',
  'week-modes',
  'week-existing',
  'week-api',
  'week-a11y',
  'week-mobile',
  'week-keyboard',
  'submit',
  'submit-cancel',
  'submit-empty',
  'submit-double',
  'submit-policy',
  'submit-resubmit',
  'submit-a11y',
  'submit-mobile',
  'submit-api',
  'submit-isolation',
  'appr-flow',
  'appr-cycle',
  'appr-scope',
  'appr-own',
  'appr-draft',
  'appr-twice',
  'appr-a11y',
  'appr-mobile',
  'appr-double',
  'appr-conflict',
  'appr-keyboard',
  'rep-basic',
  'rep-csv',
  'rep-scope',
  'rep-filters',
  'rep-a11y',
  'adm-policy',
  'adm-catalog',
  'adm-codes',
] as const;
export type WeekKey = (typeof WEEK_KEYS)[number];

const PROJECT_NAMES = ['chromium', 'firefox', 'webkit'];

/**
 * One week per (test key, browser, retry). Tests that *submit* a week cannot be reset afterwards
 * (a submitted week is locked), so each retry attempt gets a fresh week as well.
 */
const MAX_ATTEMPTS = 3;

export function weekFor(key: WeekKey, projectName: string, attempt = 0): string {
  const slot =
    (WEEK_KEYS.indexOf(key) * PROJECT_NAMES.length +
      PROJECT_NAMES.indexOf(projectName.replace(/^admin-/, ''))) *
      MAX_ATTEMPTS +
    attempt;
  const base = Date.UTC(2027, 0, 4); // Monday 2027-01-04
  return new Date(base + slot * 7 * 86_400_000).toISOString().slice(0, 10);
}

export function dayOf(week: string, offset: number): string {
  return new Date(Date.parse(`${week}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

export async function getWeek(request: APIRequestContext, week: string) {
  const response = await request.get(`${API}/timesheets/weeks/${week}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

/** Delete anything left in the week (e.g. by a retried run) so the test starts empty. */
export async function isolatedWeek(
  request: APIRequestContext,
  key: WeekKey,
  projectName: string,
  attempt = 0,
): Promise<string> {
  const week = weekFor(key, projectName, attempt);
  const data = await getWeek(request, week);
  for (const entry of data.entries) {
    await request.delete(`${API}/time-entries/${entry.id}`, { headers: CSRF });
  }
  return week;
}

interface Ref {
  id: string;
  code: string;
}

export async function refs(request: APIRequestContext) {
  const [projects, earning] = await Promise.all([
    request.get(`${API}/projects`).then((r) => r.json()),
    request.get(`${API}/earning-codes`).then((r) => r.json()),
  ]);
  const byCode = (items: Ref[]) => new Map(items.map((i) => [i.code, i.id]));
  const projectIds = byCode(projects.items);
  const earningIds = byCode(earning.items);
  return {
    project: (code: string) => projectIds.get(code)!,
    earning: (code: string) => earningIds.get(code)!,
    async task(projectCode: string, taskCode: string) {
      const tasks = await request
        .get(`${API}/projects/${projectIds.get(projectCode)}/tasks`)
        .then((r) => r.json());
      return (tasks.items as Ref[]).find((t) => t.code === taskCode)!.id;
    },
  };
}

/** Create an entry through the API (fast set-up for tests that are about something else). */
export async function createEntryViaApi(
  request: APIRequestContext,
  data: {
    work_date: string;
    hours?: string;
    description?: string;
    project?: string;
    task?: string | null;
    earning?: string;
  },
) {
  const r = await refs(request);
  const project = data.project ?? 'PRJ-001';
  const task = data.task === undefined ? 'DEV' : data.task;
  const response = await request.post(`${API}/time-entries`, {
    headers: CSRF,
    data: {
      work_date: data.work_date,
      hours: data.hours ?? '8.00',
      earning_code_id: r.earning(data.earning ?? 'REG'),
      project_id: r.project(project),
      task_id: task ? await r.task(project, task) : null,
      description: data.description ?? 'Seeded by test',
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

/** The disposable E2E database URL, derived from DATABASE_URL (same rule as playwright.config). */
function e2eDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? '';
  const url = new URL(base.replace(/^postgresql\+psycopg:/, 'postgresql:'));
  url.pathname = '/timetrack_e2e';
  return url.toString().replace(/^postgresql:/, 'postgresql+psycopg:');
}

/** Put a week into a lifecycle state (e.g. a manager's rejection, which has no API until Phase 6). */
export function setWeekStatus(
  email: string,
  week: string,
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED',
  comment?: string,
) {
  const python = process.env.BACKEND_PYTHON ?? '.venv/bin/python';
  execFileSync(
    python,
    [
      'scripts/e2e_state.py',
      '--email',
      email,
      '--week',
      week,
      '--status',
      status,
      ...(comment ? ['--comment', comment] : []),
    ],
    { cwd: '../backend', env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() }, stdio: 'pipe' },
  );
}

/** "Jan 4 – Jan 10, 2027" exactly as the app prints a week (both years when it spans New Year). */
export function rangeLabel(start: string): string {
  const fmt = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(new Date(`${iso}T00:00:00Z`));
  const end = dayOf(start, 6);
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${fmt(start, false)} – ${fmt(end, true)}`
    : `${fmt(start, true)} – ${fmt(end, true)}`;
}

/** Submit a week through the API as whoever `request` is signed in as. */
export async function submitViaApi(request: APIRequestContext, week: string, comment?: string) {
  const response = await request.post(`${API}/timesheets/weeks/${week}/submit`, {
    headers: CSRF,
    data: comment ? { comment } : {},
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/** Create one entry and submit the week; returns the week id (what the approvals API uses). */
export async function submittedWeek(
  request: APIRequestContext,
  week: string,
  options: { hours?: string; comment?: string; description?: string } = {},
): Promise<string> {
  await createEntryViaApi(request, {
    work_date: week,
    hours: options.hours ?? '8',
    description: options.description ?? 'Work for review',
  });
  return (await submitViaApi(request, week, options.comment)).id;
}

// ---- administration helpers --------------------------------------------------------------

/** A unique, valid email so specs can create people without ever colliding. */
export function uniqueEmail(label: string, projectName: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${label}-${projectName.replace(/\W/g, '')}-${stamp}@example.test`.toLowerCase();
}

export interface CreatedUser {
  id: string;
  email: string;
  temporaryPassword: string;
}

/** Create a person through the admin API (fast set-up); `request` must be signed in as an admin. */
export async function createUserViaApi(
  request: APIRequestContext,
  data: {
    email: string;
    display_name?: string;
    role?: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
    manager_id?: string | null;
  },
): Promise<CreatedUser> {
  const response = await request.post(`${API}/admin/users`, {
    headers: CSRF,
    data: {
      email: data.email,
      display_name: data.display_name ?? 'Test Person',
      role: data.role ?? 'EMPLOYEE',
      manager_id: data.manager_id ?? null,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json();
  return { id: body.user.id, email: body.user.email, temporaryPassword: body.temporary_password };
}

/** Sign in through the sign-in form (the way a person does) with an explicit password. */
export async function signInViaForm(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
