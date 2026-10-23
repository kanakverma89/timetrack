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
