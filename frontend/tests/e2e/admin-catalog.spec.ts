import type { Page } from '@playwright/test';
import {
  ADMIN,
  API,
  CSRF,
  createEntryViaApi,
  expect,
  expectNoAxeViolations,
  isolatedWeek,
  openWeek,
  refs,
  signInViaApi,
  test,
} from './fixtures';

function uniqueCode(prefix: string): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return `${prefix}-${stamp}`.toUpperCase();
}

const dialog = (page: Page) => page.getByRole('dialog');
const projectRow = (page: Page, code: string) =>
  page.getByTestId('project-row').filter({ hasText: code });

async function createProject(page: Page, code: string, name: string, description = '') {
  await page.goto(`/admin/projects?search=${code}`);
  await page.getByRole('button', { name: 'Add project' }).click();
  await dialog(page).getByLabel(/^Code/).fill(code.toLowerCase()); // saved in capitals
  await dialog(page).getByLabel(/^Name/).fill(name);
  if (description)
    await dialog(page)
      .getByLabel(/^Description/)
      .fill(description);
  await dialog(page).getByRole('button', { name: 'Create project' }).click();
  await expect(dialog(page)).toHaveCount(0);
}

async function offeredProjectCodes(page: Page): Promise<string[]> {
  const body = await (await page.request.get(`${API}/projects?active=true`)).json();
  return body.items.map((p: { code: string }) => p.code);
}

test.describe('Projects and tasks', () => {
  test('a new project and task reach employees; a task becomes mandatory; deactivating removes it', async ({
    adminPage: admin,
    employeePage: employee,
  }, testInfo) => {
    const code = uniqueCode('PRJ');
    await createProject(admin, code, 'Catalogue Test Project', 'Created by an end-to-end test');
    await expect(projectRow(admin, code)).toContainText('Catalogue Test Project');
    await expect(projectRow(admin, code)).toContainText('Active');
    await expect(admin.getByText('Saved Catalogue Test Project.')).toBeVisible();

    // Employees are offered it straight away (and it is stored in capitals).
    expect(await offeredProjectCodes(employee)).toContain(code);

    // No tasks yet: an entry on it needs none.
    const week = await isolatedWeek(
      employee.request,
      'adm-catalog',
      testInfo.project.name,
      testInfo.retry,
    );
    const r = await refs(employee.request);
    const projectId = r.project(code);
    const post = (taskId: string | null) =>
      employee.request.post(`${API}/time-entries`, {
        headers: CSRF,
        data: {
          work_date: week,
          hours: '1',
          description: 'catalogue check',
          earning_code_id: r.earning('REG'),
          project_id: projectId,
          task_id: taskId,
        },
      });
    const first = await post(null);
    expect(first.status()).toBe(201);
    await employee.request.delete(`${API}/time-entries/${(await first.json()).id}`, {
      headers: CSRF,
    });

    // Add a task through the tasks page.
    await projectRow(admin, code)
      .getByRole('link', { name: `Tasks of ${code}` })
      .click();
    await expect(admin.getByRole('heading', { level: 2, name: /Tasks of / })).toContainText(code);
    await expect(admin.getByText('This project has no tasks')).toBeVisible();
    await admin.getByRole('button', { name: 'Add task' }).click();
    await dialog(admin).getByLabel(/^Code/).fill('build');
    await dialog(admin).getByLabel(/^Name/).fill('Build things');
    await dialog(admin).getByRole('button', { name: 'Create task' }).click();
    await expect(admin.getByTestId('task-row')).toHaveCount(1);
    await expect(admin.getByTestId('task-row')).toContainText('BUILD');

    // With an active task on the project, an entry without one is refused.
    const blocked = await post(null);
    expect(blocked.status()).toBe(422);
    expect((await blocked.json()).error.field_errors.task_id).toBeTruthy();

    // The employee's entry form offers the project and then requires its task.
    await openWeek(employee, week);
    await employee.getByRole('button', { name: 'Add entry' }).click();
    const combobox = employee.getByRole('combobox', { name: /^Project/ });
    await combobox.click();
    await combobox.fill(code);
    await employee.getByRole('option', { name: new RegExp(code) }).click();
    await expect(employee.getByRole('combobox', { name: /^Task/ })).toBeVisible();
    await expect(employee.getByRole('combobox', { name: /^Task/ })).toContainText('Build things');
    await employee.keyboard.press('Escape');

    // Inactive tasks and projects are no longer offered.
    await admin.getByRole('button', { name: 'Edit BUILD' }).click();
    await dialog(admin).getByLabel('Active').uncheck();
    await dialog(admin).getByRole('button', { name: 'Save changes' }).click();
    await expect(admin.getByTestId('task-row')).toContainText('Inactive');

    await admin.goto(`/admin/projects?search=${code}`);
    await projectRow(admin, code)
      .getByRole('button', { name: `Edit ${code}` })
      .click();
    await dialog(admin).getByLabel('Active').uncheck();
    await dialog(admin).getByRole('button', { name: 'Save changes' }).click();
    await expect(projectRow(admin, code)).toContainText('Inactive');
    expect(await offeredProjectCodes(employee)).not.toContain(code);
  });

  test('codes must be new and well formed; names are required', async ({ adminPage: admin }) => {
    const code = uniqueCode('DUP');
    await createProject(admin, code, 'First');
    await admin.getByRole('button', { name: 'Add project' }).click();
    const form = dialog(admin);

    await form.getByRole('button', { name: 'Create project' }).click();
    await expect(form.getByRole('alert')).toBeFocused();
    await expect(form.getByText('Enter a code.')).toBeVisible();
    await expect(form.getByText('Enter a name.')).toBeVisible();

    await form.getByLabel(/^Code/).fill(code.toLowerCase()); // same code, other case
    await form.getByLabel(/^Name/).fill('Second');
    await form.getByRole('button', { name: 'Create project' }).click();
    await expect(form.getByText(/already exists/).first()).toBeVisible();
    await expect(form.getByLabel(/^Code/)).toHaveAttribute('aria-invalid', 'true');

    await form.getByLabel(/^Code/).fill('bad code!');
    await form.getByRole('button', { name: 'Create project' }).click();
    await expect(form.getByText(/Use letters, digits/).first()).toBeVisible();
    await admin.keyboard.press('Escape');
    await admin.goto(`/admin/projects?search=${code}`);
    await expect(admin.getByTestId('project-row')).toHaveCount(1); // the duplicate was not created
  });

  test('editing keeps the code fixed and an unchanged form cannot be saved', async ({
    adminPage: admin,
  }) => {
    const code = uniqueCode('EDT');
    await createProject(admin, code, 'Before');
    await projectRow(admin, code)
      .getByRole('button', { name: `Edit ${code}` })
      .click();
    const form = dialog(admin);
    await expect(form.getByText('(cannot be changed)')).toBeVisible();
    await expect(form.getByLabel(/^Code/)).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await form.getByLabel(/^Name/).fill('After');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(projectRow(admin, code)).toContainText('After');
  });
});

test.describe('Earning codes', () => {
  test('create, see the classification lock once used, deactivate: employees only see active codes', async ({
    adminPage: admin,
    employeePage: employee,
  }, testInfo) => {
    const code = uniqueCode('EC');
    await admin.goto('/admin/earning-codes');
    await admin.getByRole('button', { name: 'Add earning code' }).click();
    await dialog(admin).getByLabel(/^Code/).fill(code);
    await dialog(admin).getByLabel(/^Name/).fill('Catalogue Bonus');
    await dialog(admin)
      .getByLabel(/^Classification/)
      .selectOption({ label: 'Non-capped' });
    await dialog(admin).getByRole('button', { name: 'Create earning code' }).click();
    const row = admin.getByTestId('code-row').filter({ hasText: code });
    await expect(row).toContainText('Non-capped');
    await expect(row).toContainText('0 entries');

    const offered = async () =>
      (await (await employee.request.get(`${API}/earning-codes?active=true`)).json()).items.map(
        (c: { code: string }) => c.code,
      );
    expect(await offered()).toContain(code);

    // Used by an entry: the hint now warns that reclassifying changes existing totals.
    const week = await isolatedWeek(
      employee.request,
      'adm-catalog',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(employee.request, { work_date: week, hours: '2', earning: code });
    await admin.reload();
    await expect(row).toContainText('1 entry');
    await row.getByRole('button', { name: `Edit ${code}` }).click();
    // The classification is now fixed: the control says why instead of failing on save.
    const classification = dialog(admin).getByLabel(/^Classification/);
    await expect(classification).toBeDisabled();
    await expect(dialog(admin).getByText(/Fixed because 1 entry uses this code/)).toBeVisible();
    await dialog(admin).getByLabel(/^Name/).fill('Catalogue Bonus (renamed)');
    await dialog(admin).getByRole('button', { name: 'Save changes' }).click();
    await expect(row).toContainText('renamed');
    await expect(row).toContainText('Non-capped');
    // The server enforces it too, whatever the page shows.
    const ids = await (await admin.request.get(`${API}/admin/earning-codes`)).json();
    const mine = ids.items.find((c: { code: string }) => c.code === code);
    const forced = await admin.request.patch(`${API}/admin/earning-codes/${mine.id}`, {
      headers: CSRF,
      data: { classification: 'CAPPED' },
    });
    expect(forced.status()).toBe(409);

    await row.getByRole('button', { name: `Edit ${code}` }).click();
    await dialog(admin).getByLabel('Active').uncheck();
    await dialog(admin).getByRole('button', { name: 'Save changes' }).click();
    await expect(row).toContainText('Inactive');
    expect(await offered()).not.toContain(code);
    // Existing entries keep an inactive code.
    const after = await (await employee.request.get(`${API}/timesheets/weeks/${week}`)).json();
    expect(after.entries).toHaveLength(1);
    await employee.request.delete(`${API}/time-entries/${after.entries[0].id}`, { headers: CSRF });
  });
});

test.describe('Accessibility and small screens', () => {
  test('every catalogue page and dialog passes axe', async ({ adminPage: admin }) => {
    const code = uniqueCode('AXE');
    await createProject(admin, code, 'Axe Project');
    await expect(admin.getByTestId('project-row').first()).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByRole('button', { name: 'Add project' }).click();
    await expectNoAxeViolations(admin);
    await dialog(admin).getByRole('button', { name: 'Create project' }).click(); // errors showing
    await expectNoAxeViolations(admin);
    await admin.keyboard.press('Escape');

    await projectRow(admin, code)
      .getByRole('link', { name: `Tasks of ${code}` })
      .click();
    await expect(admin.getByText('This project has no tasks')).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByRole('button', { name: 'Add task' }).click();
    await expectNoAxeViolations(admin);
    await admin.keyboard.press('Escape');

    await admin.goto('/admin/earning-codes');
    await expect(admin.getByTestId('code-row').first()).toBeVisible();
    await expectNoAxeViolations(admin);
    await admin.getByRole('button', { name: 'Add earning code' }).click();
    await expectNoAxeViolations(admin);
  });

  test('catalogue pages fit a phone', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
    await signInViaApi(context.request, ADMIN);
    const phone = await context.newPage();
    for (const path of ['/admin/projects', '/admin/earning-codes', '/admin/teams']) {
      await phone.goto(path);
      await expect(phone.getByRole('heading', { level: 2 }).first()).toBeVisible();
      const overflow = await phone.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await context.close();
  });
});
