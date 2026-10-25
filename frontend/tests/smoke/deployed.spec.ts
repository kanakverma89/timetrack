import { expect, test, type APIRequestContext } from '@playwright/test';

// Non-destructive checks of a deployed copy: one far-future entry is created and removed again.
// Nothing here prints a password or token.

const EMAIL = process.env.DEMO_EMPLOYEE_EMAIL ?? 'employee@example.test';
const PASSWORD = process.env.DEMO_EMPLOYEE_PASSWORD ?? '';
const API = '/api/v1';
const CSRF = { 'X-Requested-With': 'timetrack' };
const WEEK = '2036-03-03'; // a Monday far from any real use; the test owns it
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function signIn(request: APIRequestContext) {
  const response = await request.post(`${API}/auth/login`, {
    headers: CSRF,
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(response.status(), 'sign-in through the public URL').toBe(200);
}

test.describe.configure({ mode: 'serial' });

test('the API is reachable through the frontend URL and reports ready (wakes a sleeping service)', async ({
  request,
}) => {
  const started = Date.now();
  const response = await request.get(`${API}/health/ready`);
  expect(response.status()).toBe(200);
  console.log(`health/ready answered in ${Math.round((Date.now() - started) / 1000)} s`);
});

test('the app shell loads and the sign-in form is shown', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /sign in to timetrack/i })).toBeVisible();
});

test('the public site does not expose docs, registration, internals or secrets', async ({
  request,
  page,
}) => {
  for (const path of [`${API}/docs`, `${API}/openapi.json`]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  const register = await request.post(`${API}/auth/register`, { headers: CSRF, data: {} });
  expect([404, 405]).toContain(register.status());

  const missing = await request.get(`${API}/definitely-not-a-route`);
  expect(missing.status()).toBe(404);
  const body = await missing.text();
  for (const leak of ['Traceback', 'sqlalchemy', 'psycopg', 'postgresql://', '/srv/']) {
    expect(body).not.toContain(leak);
  }

  // Security headers on the page and on the API.
  const home = await request.get('/');
  expect(home.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(home.headers()['x-content-type-options']).toBe('nosniff');
  const health = await request.get(`${API}/health`);
  expect(health.headers()['x-content-type-options']).toBe('nosniff');
  expect(health.headers()['content-security-policy']).toContain("default-src 'none'");

  // The shipped JavaScript must not contain connection strings, hosts or secret names.
  await page.goto('/');
  const scripts = await page
    .locator('script[src]')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLScriptElement).src));
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) {
    const text = await (await request.get(src)).text();
    for (const forbidden of [
      /postgres(ql)?(\+\w+)?:\/\//i,
      /neon\.tech/i,
      /SESSION_SECRET/,
      /onrender\.com/i,
    ]) {
      expect(text, `${forbidden} in ${new URL(src).pathname}`).not.toMatch(forbidden);
    }
  }
});

test('an anonymous caller is refused, and an employee cannot reach admin or approvals', async ({
  request,
}) => {
  expect((await request.get(`${API}/auth/me`)).status()).toBe(401);
  expect((await request.get(`${API}/admin/users`)).status()).toBe(401);

  await signIn(request);
  expect((await request.get(`${API}/admin/users`)).status()).toBe(403);
  expect((await request.get(`${API}/approvals`)).status()).toBe(403);
  expect(
    (await request.get(`${API}/reports/hours?date_from=${WEEK}&date_to=${WEEK}`)).status(),
  ).toBe(403);
  // Someone else's (here: nonexistent) entry looks exactly like a missing one.
  expect(
    (await request.delete(`${API}/time-entries/${UNKNOWN_ID}`, { headers: CSRF })).status(),
  ).toBe(404);
  // A state-changing call without the CSRF header is refused.
  expect((await request.post(`${API}/time-entries`, { data: {} })).status()).toBe(403);
});

test('signing in through the page works and the session cookie is secure', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(EMAIL);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'timetrack_session');
  expect(session, 'a session cookie for the frontend origin').toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe('Lax');
});

test('an entry is saved, survives a reload, and is removed again', async ({ request }) => {
  await signIn(request);
  const projects = (await (await request.get(`${API}/projects?active=true`)).json())
    .items as Array<{
    id: string;
    code: string;
  }>;
  const earning = (await (await request.get(`${API}/earning-codes?active=true`)).json())
    .items as Array<{
    id: string;
    code: string;
  }>;
  const project = projects[0]!;
  const tasks = (
    await (await request.get(`${API}/projects/${project.id}/tasks?active=true`)).json()
  ).items as Array<{ id: string }>;

  const created = await request.post(`${API}/time-entries`, {
    headers: CSRF,
    data: {
      work_date: WEEK,
      hours: '1.5',
      earning_code_id: earning[0]!.id,
      project_id: project.id,
      task_id: tasks[0]?.id ?? null,
      description: 'deployment smoke test',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const entry = await created.json();

  try {
    // A fresh read (as after a page reload) returns it with the right total.
    const week = await (await request.get(`${API}/timesheets/weeks/${WEEK}`)).json();
    expect(week.entries.map((e: { id: string }) => e.id)).toContain(entry.id);
    expect(week.summary.total_hours).toBe('1.50');
  } finally {
    const removed = await request.delete(`${API}/time-entries/${entry.id}`, { headers: CSRF });
    expect(removed.status()).toBe(204);
  }
  const after = await (await request.get(`${API}/timesheets/weeks/${WEEK}`)).json();
  expect(after.entries).toHaveLength(0);
});
