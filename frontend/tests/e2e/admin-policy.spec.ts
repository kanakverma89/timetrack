import type { Page } from '@playwright/test';
import {
  API,
  CSRF,
  createEntryViaApi,
  dayOf,
  expect,
  expectNoAxeViolations,
  isolatedWeek,
  openWeek,
  refs,
  test,
} from './fixtures';

const alertDialog = (page: Page) => page.getByRole('alertdialog');

async function openPolicy(page: Page) {
  await page.goto('/admin/policy');
  await expect(page.getByRole('heading', { level: 2, name: 'Hour policy' })).toBeVisible();
}

async function save(
  page: Page,
  fields: Partial<Record<'entry' | 'day' | 'week' | 'length', string>>,
) {
  const labels = {
    entry: /^Maximum hours in one entry/,
    day: /^Maximum hours in one day/,
    week: /^Maximum hours in one week/,
    length: /^Maximum description length/,
  };
  for (const [key, value] of Object.entries(fields)) {
    await page.getByLabel(labels[key as keyof typeof labels]).fill(value);
  }
  await page.getByRole('button', { name: 'Save policy' }).click();
}

/** Back to the server defaults whatever state an earlier (possibly failed) run left behind. */
async function restoreDefaults(page: Page) {
  const response = await page.request.delete(`${API}/admin/policy`, { headers: CSRF });
  expect(response.ok()).toBe(true);
}

test.describe('Hour policy', () => {
  // One shared setting: the tests in this file must not overlap each other.
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ adminPage }) => restoreDefaults(adminPage));
  test.afterEach(async ({ adminPage }) => restoreDefaults(adminPage));

  test('starts from the server defaults and shows what they are', async ({ adminPage: admin }) => {
    await openPolicy(admin);
    await expect(admin.getByText(/Using the defaults from the server configuration/)).toBeVisible();
    await expect(admin.getByLabel(/^Maximum hours in one entry/)).toHaveValue('24');
    await expect(admin.getByLabel(/^Maximum hours in one day/)).toHaveValue('16');
    await expect(admin.getByLabel(/^Maximum hours in one week/)).toHaveValue('60');
    await expect(admin.getByRole('button', { name: 'Restore defaults' })).toBeDisabled();
    const defaults = admin.getByRole('heading', { name: 'Server defaults' });
    await expect(defaults).toBeVisible();
  });

  test('a saved limit changes what employees can enter, at once and everywhere', async ({
    adminPage: admin,
    employeePage: employee,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'adm-policy',
      testInfo.project.name,
      testInfo.retry,
    );
    const r = await refs(employee.request);
    const taskId = await r.task('PRJ-001', 'DEV');
    const entry = (hours: string) =>
      employee.request.post(`${API}/time-entries`, {
        headers: CSRF,
        data: {
          work_date: week,
          hours,
          description: 'policy check',
          earning_code_id: r.earning('REG'),
          project_id: r.project('PRJ-001'),
          task_id: taskId,
        },
      });

    const before = await entry('13');
    expect(before.status()).toBe(201); // allowed under the default of 24
    await employee.request.delete(`${API}/time-entries/${(await before.json()).id}`, {
      headers: CSRF,
    });

    await openPolicy(admin);
    await save(admin, { entry: '12' });
    await expect(admin.getByText(/Policy saved/)).toBeVisible();
    await expect(admin.getByText(/^Customised by Jordan Admin on /)).toBeVisible();
    await expect(admin.getByLabel(/^Maximum hours in one entry/)).toHaveValue('12');

    // The API refuses it, saying why...
    const refused = await entry('13');
    expect(refused.status()).toBe(422);
    expect((await refused.json()).error.field_errors.hours).toContain('12');
    // ...exactly the limit is fine...
    const exact = await entry('12');
    expect(exact.status()).toBe(201);
    await employee.request.delete(`${API}/time-entries/${(await exact.json()).id}`, {
      headers: CSRF,
    });
    // ...and the entry form (which reads the limit from the server) enforces it before sending.
    await openWeek(employee, week);
    await employee.getByRole('button', { name: 'Add entry' }).click();
    const panel = employee.getByRole('dialog');
    await panel.getByLabel(/^Hours/).fill('13');
    await panel.getByRole('button', { name: 'Save entry' }).click();
    await expect(panel.getByText('Hours cannot exceed 12 per entry.').first()).toBeVisible();
  });

  test('the daily limit is applied when a week is submitted, with the new number in the message', async ({
    adminPage: admin,
    employeePage: employee,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'adm-policy',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(employee.request, { work_date: dayOf(week, 1), hours: '13' });

    await openPolicy(admin);
    await save(admin, { entry: '12', day: '12' });
    await expect(admin.getByText(/Policy saved/)).toBeVisible();

    await openWeek(employee, week);
    await employee.getByRole('button', { name: 'Submit week' }).click();
    const confirm = employee.getByRole('alertdialog');
    await confirm.getByRole('button', { name: 'Submit week' }).click();
    await expect(confirm.getByRole('alert')).toContainText('above the daily limit of 12.00 h');
    await employee.keyboard.press('Escape');
    // Never submitted: the failed check left the week untouched.
    const state = await (await employee.request.get(`${API}/timesheets/weeks/${week}`)).json();
    expect(state.status).toBe('DRAFT');

    // An empty limit means "no limit".
    await openPolicy(admin);
    await save(admin, { entry: '16', day: '' }); // the 13 h entry is also within the entry limit
    await expect(admin.getByText(/Policy saved/)).toBeVisible();
    await expect(admin.getByLabel(/^Maximum hours in one day/)).toHaveValue('');
    await employee.reload();
    await employee.getByRole('button', { name: 'Submit week' }).click();
    await employee.getByRole('alertdialog').getByRole('button', { name: 'Submit week' }).click();
    // The 13 h day is now acceptable (the weekly default of 60 h still holds, and is not exceeded).
    await expect(employee.getByText('Week submitted for approval.')).toBeVisible();
  });

  test('invalid numbers are explained next to the field and nothing is saved', async ({
    adminPage: admin,
  }) => {
    await openPolicy(admin);
    await save(admin, { entry: '25', day: 'abc', week: '200', length: '0' });
    await expect(admin.getByRole('alert')).toBeFocused();
    await expect(admin.getByText('Must be at most 24.')).toBeVisible();
    await expect(admin.getByText(/Use a number with at most two decimal places/)).toBeVisible();
    await expect(admin.getByText('Must be at most 168.')).toBeVisible();
    await expect(admin.getByText('Enter a whole number from 1 to 256.')).toBeVisible();
    await expect(admin.getByLabel(/^Maximum hours in one entry/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const stored = await (await admin.request.get(`${API}/admin/policy`)).json();
    expect(stored.source).not.toBe('database');

    // The server has the last word: a value the page allows but the server does not.
    const direct = await admin.request.put(`${API}/admin/policy`, {
      headers: CSRF,
      data: {
        max_hours_per_entry: '8.123',
        max_hours_per_day: null,
        max_hours_per_week: null,
        description_max_length: 100,
      },
    });
    expect(direct.status()).toBe(422);
  });

  test('restoring the defaults asks first, then removes the custom limits', async ({
    adminPage: admin,
  }) => {
    await openPolicy(admin);
    await save(admin, { entry: '10', week: '40' });
    await expect(admin.getByText(/Policy saved/)).toBeVisible();

    await admin.getByRole('button', { name: 'Restore defaults' }).click();
    const confirm = alertDialog(admin);
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(admin.getByLabel(/^Maximum hours in one entry/)).toHaveValue('10');

    await admin.getByRole('button', { name: 'Restore defaults' }).click();
    await alertDialog(admin).getByRole('button', { name: 'Restore defaults' }).click();
    await expect(admin.getByText(/Restored the defaults/)).toBeVisible();
    await expect(admin.getByLabel(/^Maximum hours in one entry/)).toHaveValue('24');
    await expect(admin.getByLabel(/^Maximum hours in one week/)).toHaveValue('60');
    await expect(admin.getByText(/Using the defaults from the server configuration/)).toBeVisible();
  });

  test('every change is in the audit log with before and after, and its author', async ({
    adminPage: admin,
  }) => {
    await openPolicy(admin);
    await save(admin, { entry: '11' });
    await expect(admin.getByText(/Policy saved/)).toBeVisible();
    await admin.goto('/admin/audit?entity=POLICY');
    const first = admin.getByTestId('audit-row').first();
    await expect(first).toContainText('Jordan Admin');
    await expect(first).toContainText('Hour policy');
    await expect(first).toContainText('hours per entry: 24 → 11');
  });

  test('page and dialog pass axe, including with errors showing', async ({ adminPage: admin }) => {
    await openPolicy(admin);
    await expectNoAxeViolations(admin);
    await save(admin, { entry: '99' });
    await expect(admin.getByRole('alert')).toBeVisible();
    await expectNoAxeViolations(admin);
    await save(admin, { entry: '9' });
    await expect(admin.getByText(/Policy saved/)).toBeVisible();
    await admin.getByRole('button', { name: 'Restore defaults' }).click();
    await expect(alertDialog(admin)).toBeVisible();
    await expectNoAxeViolations(admin);
  });
});
