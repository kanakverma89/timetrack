import type { Page } from '@playwright/test';
import {
  API,
  CSRF,
  EMPLOYEE2,
  createEntryViaApi,
  dayOf,
  expect,
  expectNoAxeViolations,
  getWeek,
  isolatedWeek,
  openWeek,
  rangeLabel,
  signInViaApi,
  submittedWeek,
  test,
} from './fixtures';

const dialog = (page: Page) => page.getByRole('alertdialog');
const summary = (page: Page) => page.getByRole('region', { name: 'Weekly summary' });
const rowFor = (page: Page, week: string) =>
  page
    .getByTestId('approval-row')
    .filter({ hasText: 'Alex Employee' })
    .filter({ hasText: rangeLabel(week) });

/** The manager's queue narrowed to one week, so paging never hides the row. */
async function openQueue(page: Page, week: string) {
  await page.goto(`/approvals?status=SUBMITTED&week=${week}`);
}

test.describe('Withdrawing a submission', () => {
  test('withdraw → edit → resubmit, and the manager sees every step', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'withdraw-flow',
      testInfo.project.name,
      testInfo.retry,
    );
    await submittedWeek(employee.request, week, { hours: '8', comment: 'First version' });

    await openQueue(manager, week);
    await expect(rowFor(manager, week)).toHaveCount(1);

    // The employee changes their mind: the week is waiting, so it can be taken back.
    await openWeek(employee, week);
    await expect(employee.getByText(/This week is submitted and read-only/)).toBeVisible();
    await expect(employee.getByRole('button', { name: /^Add entry$/ })).toHaveCount(0);
    await employee.getByRole('button', { name: 'Withdraw submission' }).click();
    await expect(dialog(employee)).toHaveAccessibleName('Withdraw this submission?');
    await expect(dialog(employee).getByRole('button', { name: 'Keep submitted' })).toBeFocused();
    await dialog(employee).getByRole('button', { name: 'Withdraw submission' }).click();

    await expect(dialog(employee)).toHaveCount(0);
    await expect(employee.getByText(/Submission withdrawn/)).toBeVisible();
    await expect(summary(employee)).toContainText('Draft');
    await expect(employee.getByRole('button', { name: 'Add entry' })).toBeVisible();
    await expect(employee.getByRole('button', { name: 'Submit week' })).toBeEnabled();
    await expect(employee.getByTestId('entry-card')).toHaveCount(1); // nothing was lost
    expect((await getWeek(employee.request, week)).status).toBe('DRAFT');

    // The manager's queue no longer offers it.
    await openQueue(manager, week);
    await expect(manager.getByText('Nothing is waiting for your review.')).toBeVisible();
    await expect(rowFor(manager, week)).toHaveCount(0);

    // The employee corrects the week and submits it again.
    await createEntryViaApi(employee.request, {
      work_date: dayOf(week, 1),
      hours: '2',
      description: 'The forgotten hours',
    });
    await employee.reload();
    await expect(employee.getByTestId('entry-card')).toHaveCount(2);
    await employee.getByRole('button', { name: 'Submit week' }).click();
    await dialog(employee).getByRole('button', { name: 'Submit week' }).click();
    await expect(employee.getByText(/This week is submitted and read-only/)).toBeVisible();

    // Back in the queue, with the whole story in its history.
    await openQueue(manager, week);
    await expect(rowFor(manager, week)).toHaveCount(1);
    await expect(rowFor(manager, week)).toContainText('10.00');
    await rowFor(manager, week)
      .getByRole('link', { name: /^Review / })
      .click();
    const history = manager.locator('.history-item');
    await expect(history).toHaveCount(3);
    await expect(history.nth(0)).toContainText('Submitted by Alex Employee');
    await expect(history.nth(1)).toContainText('Withdrawn by Alex Employee');
    await expect(history.nth(2)).toContainText('Submitted by Alex Employee');
  });

  test('once withdrawn, the manager can no longer see or decide on the week', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'withdraw-queue',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week);
    await manager.goto(`/approvals/${weekId}`);
    await expect(manager.getByRole('button', { name: 'Approve' })).toBeVisible();

    const withdrawn = await employee.request.post(`${API}/timesheets/weeks/${week}/withdraw`, {
      headers: CSRF,
    });
    expect(withdrawn.status()).toBe(200);
    expect((await withdrawn.json()).status).toBe('DRAFT');

    // The page the manager had open is stale: acting on it is refused, and nothing changes.
    const approve = await manager.request.post(`${API}/approvals/${weekId}/approve`, {
      headers: CSRF,
      data: {},
    });
    expect(approve.status()).toBe(404);
    await manager.reload();
    await expect(manager.getByRole('heading', { name: 'Timesheet not found' })).toBeVisible();
    expect((await getWeek(employee.request, week)).status).toBe('DRAFT');
  });

  test('an approved week cannot be withdrawn: no button, and the API refuses', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'withdraw-approved',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week);
    const approve = await manager.request.post(`${API}/approvals/${weekId}/approve`, {
      headers: CSRF,
      data: {},
    });
    expect(approve.status()).toBe(200);

    await openWeek(employee, week);
    await expect(summary(employee)).toContainText('Approved');
    await expect(employee.getByRole('button', { name: 'Withdraw submission' })).toHaveCount(0);

    const refused = await employee.request.post(`${API}/timesheets/weeks/${week}/withdraw`, {
      headers: CSRF,
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error.code).toBe('INVALID_TRANSITION');
    expect((await getWeek(employee.request, week)).status).toBe('APPROVED');
  });

  test('the dialog has no axe violations, and Escape returns focus to its button', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'withdraw-a11y',
      testInfo.project.name,
      testInfo.retry,
    );
    await submittedWeek(page.request, week);
    await openWeek(page, week);
    await expectNoAxeViolations(page);

    const button = page.getByRole('button', { name: 'Withdraw submission' });
    await button.click();
    await expect(dialog(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(button).toBeFocused();
    expect((await getWeek(page.request, week)).status).toBe('SUBMITTED'); // Escape changed nothing
  });

  test("another employee cannot withdraw someone else's week", async ({
    employeePage: employee,
    request,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'withdraw-isolation',
      testInfo.project.name,
      testInfo.retry,
    );
    await submittedWeek(employee.request, week);

    await signInViaApi(request, EMPLOYEE2);
    const attempt = await request.post(`${API}/timesheets/weeks/${week}/withdraw`, {
      headers: CSRF,
    });
    expect(attempt.status()).toBe(404); // they have no such week, and learn nothing about this one
    expect((await getWeek(employee.request, week)).status).toBe('SUBMITTED');

    const anonymous = await request.post(`${API}/auth/logout`, { headers: CSRF });
    expect(anonymous.ok()).toBe(true);
    const noSession = await request.post(`${API}/timesheets/weeks/${week}/withdraw`, {
      headers: CSRF,
    });
    expect(noSession.status()).toBe(401);
  });
});
