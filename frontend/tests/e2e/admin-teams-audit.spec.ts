import type { Page } from '@playwright/test';
import {
  ADMIN,
  API,
  CSRF,
  EMPLOYEE,
  EMPLOYEE2,
  createUserViaApi,
  expect,
  expectNoAxeViolations,
  signInViaApi,
  test,
  uniqueEmail,
} from './fixtures';

const dialog = (page: Page) => page.getByRole('dialog');
const teamRow = (page: Page, name: string) =>
  page.getByTestId('team-row').filter({ hasText: name });

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

async function addTeam(page: Page, name: string) {
  await page.goto('/admin/teams');
  await page.getByRole('button', { name: 'Add team' }).click();
  await dialog(page)
    .getByLabel(/^Team name/)
    .fill(name);
  await dialog(page).getByRole('button', { name: 'Create team' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(teamRow(page, name)).toBeVisible();
}

/** Tick exactly these people (found by email) in the open members dialog. */
async function tick(page: Page, ...emails: string[]) {
  for (const email of emails) {
    await dialog(page).getByLabel('Find people').fill(email);
    const box = dialog(page).getByRole('checkbox', { name: new RegExp(email.replace('.', '\\.')) });
    await expect(box).toBeVisible();
    await box.check();
  }
}

test.describe('Teams', () => {
  test('create, add and remove members, rename, delete: people are never affected', async ({
    adminPage: admin,
  }) => {
    const name = uniqueName('Platform');
    await addTeam(admin, name);
    await expect(teamRow(admin, name)).toContainText('0');

    await teamRow(admin, name)
      .getByRole('button', { name: `Members of ${name}` })
      .click();
    await expect(dialog(admin).getByText('0 selected')).toBeVisible();
    await tick(admin, EMPLOYEE, EMPLOYEE2);
    await expect(dialog(admin).getByText('2 selected')).toBeVisible();
    await dialog(admin).getByRole('button', { name: 'Save members' }).click();
    await expect(dialog(admin)).toHaveCount(0);
    await expect(teamRow(admin, name).locator('[data-label="Members"]')).toHaveText('2');

    // The saved membership is what the dialog shows next time; take one person out.
    await teamRow(admin, name)
      .getByRole('button', { name: `Members of ${name}` })
      .click();
    await expect(dialog(admin).getByText('2 selected')).toBeVisible();
    await dialog(admin).getByLabel('Find people').fill(EMPLOYEE2);
    await dialog(admin)
      .getByRole('checkbox', { name: /employee2@/ })
      .uncheck();
    await dialog(admin).getByLabel('Find people').fill(EMPLOYEE);
    await expect(dialog(admin).getByRole('checkbox', { name: /employee@example/ })).toBeChecked();
    await dialog(admin).getByRole('button', { name: 'Save members' }).click();
    await expect(teamRow(admin, name).locator('[data-label="Members"]')).toHaveText('1');

    const renamed = `${name} (renamed)`;
    await teamRow(admin, name)
      .getByRole('button', { name: `Rename ${name}` })
      .click();
    await expect(dialog(admin).getByRole('button', { name: 'Save' })).toBeDisabled(); // unchanged
    await dialog(admin)
      .getByLabel(/^Team name/)
      .fill(renamed);
    await dialog(admin).getByRole('button', { name: 'Save' }).click();
    await expect(teamRow(admin, renamed)).toBeVisible();

    await teamRow(admin, renamed)
      .getByRole('button', { name: `Delete ${renamed}` })
      .click();
    const confirm = admin.getByRole('alertdialog');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(confirm).toContainText('not affected');
    await confirm.getByRole('button', { name: 'Delete team' }).click();
    await expect(teamRow(admin, renamed)).toHaveCount(0);

    // Alex still exists, active, with their manager.
    const people = await (await admin.request.get(`${API}/admin/users?search=${EMPLOYEE}`)).json();
    expect(people.items[0]).toMatchObject({ is_active: true });
  });

  test('a duplicate name is explained beside the field', async ({ adminPage: admin }) => {
    const name = uniqueName('Twice');
    await addTeam(admin, name);
    await admin.getByRole('button', { name: 'Add team' }).click();
    await dialog(admin)
      .getByLabel(/^Team name/)
      .fill(name.toUpperCase());
    await dialog(admin).getByRole('button', { name: 'Create team' }).click();
    await expect(
      dialog(admin)
        .getByText(/already exists/)
        .first(),
    ).toBeVisible();
    await expect(dialog(admin).getByLabel(/^Team name/)).toHaveAttribute('aria-invalid', 'true');
    await dialog(admin)
      .getByLabel(/^Team name/)
      .fill('');
    await dialog(admin).getByRole('button', { name: 'Create team' }).click();
    await expect(dialog(admin).getByRole('alert')).toBeFocused();
    await expect(dialog(admin).getByText('Enter a name.')).toBeVisible();
  });

  test('pages and dialogs pass axe', async ({ adminPage: admin }) => {
    const name = uniqueName('Axe');
    await addTeam(admin, name);
    await expectNoAxeViolations(admin);
    await teamRow(admin, name)
      .getByRole('button', { name: `Members of ${name}` })
      .click();
    await expect(dialog(admin).getByRole('checkbox').first()).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.keyboard.press('Escape');
    await teamRow(admin, name)
      .getByRole('button', { name: `Delete ${name}` })
      .click();
    await expectNoAxeViolations(admin);
  });
});

test.describe('Audit log', () => {
  test('changes appear with who, what and before/after; people are named, never emailed', async ({
    adminPage: admin,
  }, testInfo) => {
    const teamName = uniqueName('Audited');
    await addTeam(admin, teamName);
    await teamRow(admin, teamName)
      .getByRole('button', { name: `Members of ${teamName}` })
      .click();
    await tick(admin, EMPLOYEE);
    await dialog(admin).getByRole('button', { name: 'Save members' }).click();
    await expect(dialog(admin)).toHaveCount(0);

    const person = uniqueEmail('audited', testInfo.project.name);
    // Names are unique per run: the audit shows *current* names, so a repeated name (an earlier
    // browser's run in the same database) would match someone else's rows.
    const tag = uniqueName('').trim().replace(/\s+/g, '');
    const original = `Audrey Audited ${tag}`;
    const renamed = `Audrey Renamed ${tag}`;
    const created = await createUserViaApi(admin.request, {
      email: person,
      display_name: original,
    });
    expect(
      (
        await admin.request.patch(`${API}/admin/users/${created.id}`, {
          headers: CSRF,
          data: { display_name: renamed, role: 'MANAGER' },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await admin.request.post(`${API}/admin/users/${created.id}/reset-password`, {
          headers: CSRF,
        })
      ).ok(),
    ).toBe(true);

    await admin.goto('/admin/audit?entity=TEAM');
    const members = admin
      .getByTestId('audit-row')
      .filter({ hasText: 'Changed members' })
      .filter({ hasText: teamName });
    await expect(members).toHaveCount(1);
    await expect(members).toContainText('Jordan Admin');
    await expect(members).toContainText('added: Alex Employee'); // a name, resolved at read time
    await expect(
      admin.getByTestId('audit-row').filter({ hasText: 'Created' }).filter({ hasText: teamName }),
    ).toHaveCount(1);

    await admin.goto('/admin/audit?entity=USER');
    const mine = admin.getByTestId('audit-row').filter({ hasText: renamed });
    await expect(mine.filter({ hasText: 'Reset password' })).toHaveCount(1);
    await expect(mine.filter({ hasText: 'Changed' })).toContainText('role: EMPLOYEE → MANAGER');
    await expect(mine.filter({ hasText: 'Changed' })).toContainText('name changed'); // not the names
    await expect(mine.filter({ hasText: 'Created' })).toHaveCount(1);

    // Nothing in the whole audit text is a password or an email address.
    const text = await admin.getByTestId('audit-table').innerText();
    expect(text).not.toContain(created.temporaryPassword);
    expect(text).not.toContain(person);
    expect(text).not.toContain(original); // the old name was never recorded
    expect(text).not.toMatch(/[\w.+-]+@example\.test/);
  });

  test('filter, page and reload keep their place; the list is newest first', async ({
    adminPage: admin,
  }) => {
    // Enough events that a second page exists whatever else has run.
    for (let i = 0; i < 3; i += 1) await addTeam(admin, uniqueName('Filler'));
    await admin.goto('/admin/audit');
    await expect(admin.getByTestId('audit-row').first()).toBeVisible();
    const all = await admin.getByTestId('audit-row').count();
    expect(all).toBeGreaterThan(0);

    await admin.getByLabel('What changed').selectOption({ label: 'Teams' });
    await expect(admin).toHaveURL(/entity=TEAM/);
    const rows = admin.getByTestId('audit-row');
    // Wait for the filtered data to replace the previous page, then check every row.
    await expect(rows.filter({ hasNotText: '· Teams' })).toHaveCount(0);
    await expect(rows.first()).toContainText('· Teams');
    await admin.reload();
    await expect(admin.getByLabel('What changed')).toHaveValue('TEAM');

    // Newest first.
    const times = await rows.locator('th[data-label="When"]').allInnerTexts();
    const stamps = times.map((t) => Date.parse(t.replace(/(\d), (\d)/, '$1 $2')));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));

    await admin.getByLabel('What changed').selectOption({ label: 'Policy' });
    await expect(admin.getByText(/Nothing recorded|Policy/).first()).toBeVisible();
  });

  test('only administrators can read it', async ({ employeePage: employee }) => {
    expect((await employee.request.get(`${API}/admin/audit`)).status()).toBe(403);
    await employee.goto('/admin/audit');
    await expect(
      employee.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });

  test('passes axe and fits a phone', async ({ adminPage: admin, browser, baseURL }) => {
    await admin.goto('/admin/audit');
    await expect(admin.getByTestId('audit-row').first()).toBeVisible();
    await expectNoAxeViolations(admin);

    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
    await signInViaApi(context.request, ADMIN);
    const phone = await context.newPage();
    await phone.goto('/admin/audit');
    await expect(phone.getByTestId('audit-row').first()).toBeVisible();
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(phone);
    await context.close();
  });
});
