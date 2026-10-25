import { ADMIN, EMPLOYEE, PASSWORD, expect, signInViaApi, signInViaForm, test } from './fixtures';

// Signing out from an admin page and signing in as someone else must not send them to that page.
test('the next person is not sent to the page the previous person signed out from', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  await signInViaApi(context.request, ADMIN);
  const page = await context.newPage();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { level: 2, name: 'Users' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await signInViaForm(page, EMPLOYEE, PASSWORD);
  await expect(page.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();
  await expect(page.getByText('You do not have access to this page')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/admin/);
  await context.close();
});
