import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

export const EMPLOYEE = 'employee@example.test';
export const EMPLOYEE2 = 'employee2@example.test';
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

export const test = base.extend<{ employeePage: Page }>({
  employeePage: async ({ page }, use) => {
    await signInViaApi(page.request, EMPLOYEE);
    await use(page);
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
] as const;
export type WeekKey = (typeof WEEK_KEYS)[number];

const PROJECT_NAMES = ['chromium', 'firefox', 'webkit'];

export function weekFor(key: WeekKey, projectName: string): string {
  const slot = WEEK_KEYS.indexOf(key) * PROJECT_NAMES.length + PROJECT_NAMES.indexOf(projectName);
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
): Promise<string> {
  const week = weekFor(key, projectName);
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
