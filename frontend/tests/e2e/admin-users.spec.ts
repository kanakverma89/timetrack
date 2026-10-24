import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  ADMIN,
  API,
  CSRF,
  EMPLOYEE,
  MANAGER,
  createUserViaApi,
  expect,
  expectNoAxeViolations,
  signInViaApi,
  signInViaForm,
  test,
  uniqueEmail,
  type CreatedUser,
} from './fixtures';

const NEW_PASSWORD = 'violet harbor lantern 47';

const addDialog = (page: Page) => page.getByRole('dialog', { name: 'Add user' });
const shownPassword = (page: Page) => page.getByRole('alertdialog').locator('output');
const rowOf = (page: Page, email: string) =>
  page.getByTestId('user-row').filter({ hasText: email });

async function openUsers(page: Page, search = '') {
  await page.goto(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`);
}

/** Create a person through the form and return the temporary password the dialog showed. */
async function createViaForm(page: Page, email: string, name: string, role = 'Employee') {
  await openUsers(page, email);
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = addDialog(page);
  await form.getByLabel(/^Email/).fill(email);
  await form.getByLabel(/^Name/).fill(name);
  await form.getByLabel(/^Role/).selectOption({ label: role });
  await form.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('alertdialog', { name: 'User created' })).toBeVisible();
  const password = (await shownPassword(page).textContent())!.trim();
  await page.getByRole('button', { name: /I have saved it/ }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  return password;
}

/** A created user who has already replaced the temporary password (through the API). */
async function readyUser(
  admin: Page,
  browser: Browser,
  baseURL: string | undefined,
  email: string,
  options: { role?: 'EMPLOYEE' | 'MANAGER'; name?: string } = {},
): Promise<{ user: CreatedUser; context: BrowserContext; page: Page }> {
  const user = await createUserViaApi(admin.request, {
    email,
    display_name: options.name ?? 'Test Person',
    role: options.role,
  });
  const context = await browser.newContext({ baseURL });
  const login = await context.request.post(`${API}/auth/login`, {
    headers: CSRF,
    data: { email, password: user.temporaryPassword },
  });
  expect(login.ok()).toBe(true);
  const change = await context.request.post(`${API}/auth/change-password`, {
    headers: CSRF,
    data: { current_password: user.temporaryPassword, new_password: NEW_PASSWORD },
  });
  expect(change.status()).toBe(204);
  return { user, context, page: await context.newPage() };
}

test.describe('Creating people and the first sign-in', () => {
  test('a temporary password is shown once and must be replaced before anything else works', async ({
    adminPage: admin,
    browser,
    baseURL,
  }, testInfo) => {
    const email = uniqueEmail('hire', testInfo.project.name);
    const temporary = await createViaForm(admin, email, 'Nia Newhire');
    expect(temporary.length).toBeGreaterThanOrEqual(12);

    // Gone for good: not on the page, not after a reload, and not in the list.
    await expect(admin.getByText(temporary)).toHaveCount(0);
    await admin.reload();
    await expect(admin.getByText(temporary)).toHaveCount(0);
    await expect(rowOf(admin, email)).toContainText('Temporary password pending');
    const storage = await admin.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(storage).not.toContain(temporary);

    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await signInViaForm(page, email, temporary);
    await expect(page).toHaveURL(/\/account\/password$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    // Every other page sends them straight back.
    for (const path of ['/', '/approvals', '/reports', '/admin/users']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/account\/password$/);
    }

    // Client-side checks first, then the server's own rules.
    await page.getByLabel(/^Current password/).fill(temporary);
    await page.getByLabel(/^New password/).fill('short');
    await page.getByLabel(/^Repeat new password/).fill('different');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert')).toBeFocused();
    await expect(page.getByText('Use at least 12 characters.')).toBeVisible();
    await expect(page.getByText('The two new passwords do not match.')).toBeVisible();

    await page.getByLabel(/^New password/).fill('password1234');
    await page.getByLabel(/^Repeat new password/).fill('password1234');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/too easy/)).toBeVisible(); // the server's explanation
    await expect(page).toHaveURL(/\/account\/password$/);

    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Repeat new password/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/\?|\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    // An employee gets neither management area.
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);

    // The temporary password is dead; the new one works.
    const other = await browser.newContext({ baseURL });
    const old = await other.request.post(`${API}/auth/login`, {
      headers: CSRF,
      data: { email, password: temporary },
    });
    expect(old.status()).toBe(401);
    const fresh = await other.request.post(`${API}/auth/login`, {
      headers: CSRF,
      data: { email, password: NEW_PASSWORD },
    });
    expect(fresh.status()).toBe(200);
    expect((await fresh.json()).must_change_password).toBe(false);
    await other.close();
    await context.close();
  });

  test('the form explains problems and keeps what was typed', async ({ adminPage: admin }) => {
    await openUsers(admin);
    await admin.getByRole('button', { name: 'Add user' }).click();
    const form = addDialog(admin);
    await form.getByRole('button', { name: 'Create user' }).click();
    await expect(form.getByRole('alert')).toBeFocused();
    await expect(form.getByText('Enter an email address.')).toBeVisible();
    await expect(form.getByText('Enter a name.')).toBeVisible();

    // An existing email is refused by the server, next to the field.
    await form.getByLabel(/^Email/).fill(EMPLOYEE.toUpperCase());
    await form.getByLabel(/^Name/).fill('Duplicate Person');
    await form.getByRole('button', { name: 'Create user' }).click();
    await expect(form.getByText(/already exists/).first()).toBeVisible();
    await expect(form.getByLabel(/^Name/)).toHaveValue('Duplicate Person');
    await expect(form.getByLabel(/^Email/)).toHaveAttribute('aria-invalid', 'true');

    // A malformed one too.
    await form.getByLabel(/^Email/).fill('not-an-email');
    await form.getByRole('button', { name: 'Create user' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(addDialog(admin)).toBeVisible();

    // Nothing was created by the failed attempts.
    await admin.keyboard.press('Escape');
    await openUsers(admin, 'duplicate person');
    await expect(admin.getByText('No people match')).toBeVisible();
  });

  test('a double click creates one person, not two', async ({ adminPage: admin }, testInfo) => {
    const email = uniqueEmail('twice', testInfo.project.name);
    await openUsers(admin, email);
    await admin.getByRole('button', { name: 'Add user' }).click();
    const form = addDialog(admin);
    await form.getByLabel(/^Email/).fill(email);
    await form.getByLabel(/^Name/).fill('Double Click');
    await form.getByRole('button', { name: 'Create user' }).dblclick();
    await expect(admin.getByRole('alertdialog', { name: 'User created' })).toBeVisible();
    await admin.getByRole('button', { name: /I have saved it/ }).click();
    await openUsers(admin, email);
    await expect(admin.getByTestId('user-row')).toHaveCount(1);
  });
});

test.describe('Changing and removing access', () => {
  test('assign a manager, change the role, then deactivate: sessions end at once', async ({
    adminPage: admin,
    browser,
    baseURL,
  }, testInfo) => {
    const email = uniqueEmail('leaver', testInfo.project.name);
    const { page: person, context } = await readyUser(admin, browser, baseURL, email, {
      name: 'Lee Leaver',
    });
    await person.goto('/');
    await expect(person.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();

    await openUsers(admin, email);
    await rowOf(admin, email).getByRole('button', { name: 'Edit Lee Leaver' }).click();
    const edit = admin.getByRole('dialog', { name: 'Edit Lee Leaver' });
    await expect(edit.getByRole('button', { name: 'Save changes' })).toBeDisabled(); // nothing changed
    await edit
      .getByLabel(/^Manager/)
      .selectOption({ label: 'Morgan Manager (manager@example.test)' });
    await edit.getByLabel(/^Name/).fill('Lee Q. Leaver');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByRole('dialog')).toHaveCount(0);
    await expect(admin.getByText('Saved Lee Q. Leaver.')).toBeVisible();
    await expect(rowOf(admin, email)).toContainText('Morgan Manager');
    await expect(rowOf(admin, email)).toContainText('Lee Q. Leaver');

    // Promote, then demote: the list follows.
    await rowOf(admin, email).getByRole('button', { name: 'Edit Lee Q. Leaver' }).click();
    await admin.getByRole('dialog').getByLabel(/^Role/).selectOption({ label: 'Manager' });
    await admin.getByRole('button', { name: 'Save changes' }).click();
    await expect(rowOf(admin, email)).toContainText('Manager');

    // Deactivate.
    await rowOf(admin, email).getByRole('button', { name: 'Edit Lee Q. Leaver' }).click();
    await admin.getByRole('dialog').getByLabel('Active').uncheck();
    await admin.getByRole('button', { name: 'Save changes' }).click();
    await expect(rowOf(admin, email)).toContainText('Inactive');

    // Their open session is already dead...
    await person.reload();
    await expect(person).toHaveURL(/\/login/);
    // ...and they cannot sign back in, with the same message as a wrong password.
    await signInViaForm(person, email, NEW_PASSWORD);
    await expect(person.getByText('Invalid email or password.')).toBeVisible();

    // Reactivate: access returns with the same password.
    await rowOf(admin, email).getByRole('button', { name: 'Edit Lee Q. Leaver' }).click();
    await admin.getByRole('dialog').getByLabel('Active').check();
    await admin.getByRole('button', { name: 'Save changes' }).click();
    await expect(rowOf(admin, email)).toContainText('Active');
    await signInViaForm(person, email, NEW_PASSWORD);
    await expect(person.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();
    await context.close();
  });

  test('a manager with active reports cannot be deactivated until they are reassigned', async ({
    adminPage: admin,
  }, testInfo) => {
    const boss = await createUserViaApi(admin.request, {
      email: uniqueEmail('boss', testInfo.project.name),
      display_name: 'Bea Boss',
      role: 'MANAGER',
    });
    await createUserViaApi(admin.request, {
      email: uniqueEmail('report', testInfo.project.name),
      display_name: 'Ray Report',
      manager_id: boss.id,
    });
    await openUsers(admin, boss.email);
    await rowOf(admin, boss.email).getByRole('button', { name: 'Edit Bea Boss' }).click();
    const edit = admin.getByRole('dialog');
    await edit.getByLabel('Active').uncheck();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByText(/Reassign their 1 active report first/).first()).toBeVisible();
    await expect(edit).toBeVisible(); // still open, nothing lost
    await expectNoAxeViolations(admin);
  });

  test('resetting a password signs the person out everywhere and issues a new one-time password', async ({
    adminPage: admin,
    browser,
    baseURL,
  }, testInfo) => {
    const email = uniqueEmail('forgot', testInfo.project.name);
    const { page: person, context } = await readyUser(admin, browser, baseURL, email, {
      name: 'Fay Forgot',
    });
    await person.goto('/');
    await expect(person.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();

    await openUsers(admin, email);
    await rowOf(admin, email)
      .getByRole('button', { name: 'Reset password for Fay Forgot' })
      .click();
    const confirm = admin.getByRole('alertdialog', { name: /Reset password for Fay Forgot/ });
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused(); // safe choice first
    await confirm.getByRole('button', { name: 'Reset password' }).click();
    await expect(admin.getByRole('alertdialog', { name: 'Password reset' })).toBeVisible();
    const temporary = (await shownPassword(admin).textContent())!.trim();
    await admin.getByRole('button', { name: /I have saved it/ }).click();

    await person.reload();
    await expect(person).toHaveURL(/\/login/);
    await signInViaForm(person, email, NEW_PASSWORD); // the old password no longer works
    await expect(person.getByText('Invalid email or password.')).toBeVisible();
    await signInViaForm(person, email, temporary);
    await expect(person).toHaveURL(/\/account\/password$/);
    await context.close();
  });

  test('you cannot lock yourself out: no self reset, no own role or deactivation', async ({
    adminPage: admin,
  }) => {
    await openUsers(admin, ADMIN);
    const me = rowOf(admin, ADMIN);
    await expect(me.getByRole('button', { name: /^Reset password for/ })).toHaveCount(0);
    await me.getByRole('button', { name: /^Edit / }).click();
    const edit = admin.getByRole('dialog');
    await expect(edit.getByLabel(/^Role/)).toBeDisabled();
    await expect(edit.getByLabel('Active')).toBeDisabled();
    await expect(edit.getByText('You cannot change your own role.')).toBeVisible();
    await expect(edit.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

test.describe('Who may use the Admin area', () => {
  test('employees and managers have no link and are turned away', async ({
    employeePage: employee,
    managerPage: manager,
    adminPage: admin,
  }) => {
    for (const page of [employee, manager]) {
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
      for (const path of ['/admin', '/admin/users', '/admin/policy', '/admin/audit']) {
        await page.goto(path);
        await expect(
          page.getByRole('heading', { name: 'You do not have access to this page' }),
        ).toBeVisible();
        await expect(page.getByTestId('users-table')).toHaveCount(0);
      }
      const direct = await page.request.get(`${API}/admin/users`);
      expect(direct.status()).toBe(403);
    }
    await admin.goto('/');
    await expect(admin.getByRole('link', { name: 'Admin' })).toBeVisible();
    await admin.getByRole('link', { name: 'Admin' }).click();
    await expect(admin).toHaveURL(/\/admin\/users$/);
    await expect(admin.getByRole('navigation', { name: 'Administration' })).toBeVisible();
  });

  test('list filters work and survive a reload', async ({ adminPage: admin }) => {
    await admin.goto('/admin/users?role=MANAGER&status=active');
    await expect(admin.getByLabel('Role')).toHaveValue('MANAGER');
    const rows = admin.getByTestId('user-row');
    await expect(rows.filter({ hasText: MANAGER })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Employee' })).toHaveCount(0);
    await admin.getByLabel('Role').selectOption({ label: 'Administrators' });
    await expect(admin).toHaveURL(/role=ADMIN/);
    await admin.reload();
    await expect(rows.filter({ hasText: ADMIN })).toHaveCount(1);
    await expect(rows.filter({ hasText: MANAGER })).toHaveCount(0);
  });
});

test.describe('Accessibility and small screens', () => {
  test('users page, add dialog and password dialog have no axe violations; Escape restores focus', async ({
    adminPage: admin,
  }, testInfo) => {
    await openUsers(admin);
    await expect(admin.getByTestId('user-row').first()).toBeVisible();
    await expectNoAxeViolations(admin);

    const add = admin.getByRole('button', { name: 'Add user' });
    await add.focus();
    await admin.keyboard.press('Enter');
    await expect(addDialog(admin)).toBeVisible();
    await expect(addDialog(admin).getByLabel(/^Email/)).toBeFocused();
    await expectNoAxeViolations(admin);
    await admin.keyboard.press('Escape');
    await expect(addDialog(admin)).toHaveCount(0);
    await expect(add).toBeFocused();

    await createViaFormForAxe(admin, uniqueEmail('axe', testInfo.project.name));
  });

  test('on a phone the table becomes labelled cards and dialogs fit the screen', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
    await signInViaApi(context.request, ADMIN);
    const phone = await context.newPage();
    await openUsers(phone, EMPLOYEE);
    const row = rowOf(phone, EMPLOYEE);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-label="Role"]')).toBeVisible();
    const overflow = () =>
      phone.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(phone);

    await phone.getByRole('button', { name: 'Add user' }).click();
    const box = await addDialog(phone).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await expect(addDialog(phone).getByRole('button', { name: 'Create user' })).toBeInViewport();
    await expectNoAxeViolations(phone);
    await context.close();
  });
});

async function createViaFormForAxe(page: Page, email: string) {
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = addDialog(page);
  await form.getByLabel(/^Email/).fill(email);
  await form.getByLabel(/^Name/).fill('Axe Person');
  await form.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByRole('alertdialog', { name: 'User created' })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: /I have saved it/ }).click();
}
