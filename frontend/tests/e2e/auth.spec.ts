import { expect, test, EMPLOYEE, PASSWORD, expectNoAxeViolations } from './fixtures';

test.describe('authentication', () => {
  test('redirects an anonymous visitor to sign-in, then back after signing in', async ({
    page,
  }) => {
    await page.goto('/?week=2026-10-12');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to TimeTrack' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByLabel(/email/i).fill(EMPLOYEE);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/\?week=2026-10-12$/);
    await expect(page.getByRole('heading', { name: 'Oct 12 – Oct 18, 2026' })).toBeVisible();
    await expect(page.getByText('Alex Employee')).toBeVisible();
  });

  test('rejects a wrong password with a generic message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(EMPLOYEE);
    await page.getByLabel(/password/i).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('stores the session in an HttpOnly cookie, not in web storage', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(EMPLOYEE);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Timesheet' })).toBeVisible();

    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === 'timetrack_session');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Lax');
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(storage).not.toContain(session?.value ?? 'no-cookie');
    expect(await page.evaluate(() => document.cookie)).not.toContain('timetrack_session');
  });

  test('sign out ends the session and protects the dashboard again', async ({
    employeePage: page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    const api = await page.request.get('/api/v1/auth/me');
    expect(api.status()).toBe(401);
  });
});
