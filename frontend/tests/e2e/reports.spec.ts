import { readFile } from 'node:fs/promises';
import type { Browser, Page } from '@playwright/test';
import {
  API,
  CSRF,
  EMPLOYEE2,
  EMPLOYEE3,
  MANAGER,
  createEntryViaApi,
  dayOf,
  expect,
  expectNoAxeViolations,
  isolatedWeek,
  rangeLabel,
  signInViaApi,
  submitViaApi,
  test,
} from './fixtures';

const DECISION = { headers: CSRF, data: {} };

/** Open the report for exactly one week (the tests own their weeks, so the numbers are exact). */
async function openReport(page: Page, week: string, extra = '') {
  await page.goto(`/reports?from=${week}&to=${dayOf(week, 6)}${extra}`);
}

const rows = (page: Page) => page.getByTestId('report-row');
const cell = (row: ReturnType<typeof rows>, label: string) =>
  row.locator(`[data-label="${label}"]`);

/** One approved week for the signed-in employee; returns nothing, the numbers are in the page. */
async function approveWeek(
  employee: Page,
  manager: Page,
  week: string,
  entries: Array<{
    offset: number;
    hours: string;
    earning: string;
    project: string;
    task: string | null;
  }>,
) {
  for (const e of entries) {
    await createEntryViaApi(employee.request, {
      work_date: dayOf(week, e.offset),
      hours: e.hours,
      earning: e.earning,
      project: e.project,
      task: e.task,
    });
  }
  const submitted = await submitViaApi(employee.request, week);
  const response = await manager.request.post(`${API}/approvals/${submitted.id}/approve`, DECISION);
  expect(response.status(), await response.text()).toBe(200);
}

async function inNewContext(browser: Browser, baseURL: string | undefined, email: string) {
  const context = await browser.newContext({ baseURL });
  await signInViaApi(context.request, email);
  return { context, page: await context.newPage() };
}

test.describe('Hours report', () => {
  test('approved hours by person, project, earning code and week; totals reconcile', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'rep-basic',
      testInfo.project.name,
      testInfo.retry,
    );
    await approveWeek(employee, manager, week, [
      { offset: 0, hours: '8', earning: 'REG', project: 'PRJ-001', task: 'DEV' },
      { offset: 1, hours: '2.5', earning: 'OVT', project: 'PRJ-002', task: 'IMP' },
    ]);

    await openReport(manager, week);
    await expect(manager.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await expect(rows(manager)).toHaveCount(1);
    const alex = rows(manager).first();
    await expect(alex).toContainText('Alex Employee');
    await expect(alex).toContainText('employee@example.test');
    await expect(cell(alex, 'Total hours')).toHaveText('10.50');
    await expect(cell(alex, 'Capped')).toHaveText('8.00');
    await expect(cell(alex, 'Non-capped')).toHaveText('2.50');
    await expect(cell(alex, 'Entries')).toHaveText('2');
    const totals = manager.getByTestId('report-totals');
    await expect(cell(totals, 'Total hours')).toHaveText('10.50');
    await expect(cell(totals, 'People')).toHaveText('1');

    await manager.getByLabel('Group by').selectOption({ label: 'Project' });
    await expect(manager).toHaveURL(/group=project/);
    await expect(rows(manager)).toHaveCount(2);
    await expect(rows(manager).filter({ hasText: 'PRJ-001' })).toContainText('8.00');
    await expect(rows(manager).filter({ hasText: 'PRJ-002' })).toContainText('2.50');
    await expect(cell(manager.getByTestId('report-totals'), 'Total hours')).toHaveText('10.50');

    await manager.getByLabel('Group by').selectOption({ label: 'Earning code' });
    await expect(rows(manager).filter({ hasText: 'REG' })).toContainText('8.00');
    await expect(rows(manager).filter({ hasText: 'OVT' })).toContainText('2.50');

    await manager.getByLabel('Group by').selectOption({ label: 'Week' });
    await expect(rows(manager)).toHaveCount(1);
    await expect(rows(manager).first()).toContainText(rangeLabel(week));

    // Filters are in the address, so a reload (or a shared link) shows the same report.
    await manager.reload();
    await expect(manager.getByLabel('Group by')).toHaveValue('week');
    await expect(rows(manager)).toHaveCount(1);
  });

  test('the CSV is the same report, for every row and the current filters', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'rep-csv',
      testInfo.project.name,
      testInfo.retry,
    );
    await approveWeek(employee, manager, week, [
      { offset: 0, hours: '8', earning: 'REG', project: 'PRJ-001', task: 'DEV' },
      { offset: 1, hours: '2.5', earning: 'OVT', project: 'PRJ-002', task: 'IMP' },
    ]);
    await openReport(manager, week, '&group=project');
    await expect(rows(manager)).toHaveCount(2);
    const link = manager.getByRole('link', { name: 'Download CSV' });
    await expect(link).toHaveAttribute('href', /group_by=project/);
    await expect(link).toHaveAttribute('href', new RegExp(`date_from=${week}`));

    const [download] = await Promise.all([manager.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const csv = await readFile((await download.path())!, 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Group,Detail,Total hours,Capped hours,Non-capped hours,Entries,People');
    expect(lines).toContain('PRJ-001,Platform Development,8.00,8.00,0.00,1,1');
    expect(lines).toContain('PRJ-002,Customer Portal,2.50,0.00,2.50,1,1');
    expect(lines.at(-1)).toBe('Total,,10.50,8.00,2.50,2,1');
  });

  test('weeks still waiting are included only when asked for; drafts never are', async ({
    employeePage: employee,
    browser,
    baseURL,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'rep-filters',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(employee.request, { work_date: week, hours: '5' });
    const { context, page: manager } = await inNewContext(browser, baseURL, MANAGER);

    // A draft appears in no report, whatever statuses are ticked.
    await openReport(manager, week, '&status=APPROVED&status=SUBMITTED&status=REJECTED');
    await expect(manager.getByText('No hours in this range')).toBeVisible();

    await submitViaApi(employee.request, week);
    await openReport(manager, week);
    await expect(manager.getByRole('checkbox', { name: 'Approved' })).toBeChecked();
    await expect(manager.getByRole('checkbox', { name: 'Approved' })).toBeDisabled(); // the last ticked box stays on
    await expect(manager.getByText('No hours in this range')).toBeVisible();

    await manager.getByRole('checkbox', { name: 'Waiting for review' }).check();
    await expect(manager.getByRole('checkbox', { name: 'Approved' })).toBeEnabled();
    await expect(rows(manager)).toHaveCount(1);
    await expect(cell(rows(manager).first(), 'Total hours')).toHaveText('5.00');
    await manager.getByRole('checkbox', { name: 'Approved' }).uncheck();
    await expect(rows(manager)).toHaveCount(1); // submitted-only is a valid selection
    await expect(manager).toHaveURL(/status=SUBMITTED/);
    await expect(manager).not.toHaveURL(/status=APPROVED/);
    await context.close();
  });

  test('a manager sees only their own reports; an administrator sees everyone; employees nobody', async ({
    employeePage: employee,
    managerPage: morgan,
    manager2Page: riley,
    adminPage: admin,
    browser,
    baseURL,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'rep-scope',
      testInfo.project.name,
      testInfo.retry,
    );
    const tasks = { offset: 0, earning: 'REG', project: 'PRJ-001', task: 'DEV' };
    await approveWeek(employee, morgan, week, [{ ...tasks, hours: '8' }]); // Alex → Morgan

    const taylor = await inNewContext(browser, baseURL, EMPLOYEE3); // Taylor → Riley
    await approveWeek(taylor.page, riley, week, [{ ...tasks, hours: '4' }]);
    const sam = await inNewContext(browser, baseURL, EMPLOYEE2); // Sam → Morgan, only a draft
    await createEntryViaApi(sam.page.request, { work_date: week, hours: '6' });

    await openReport(morgan, week);
    await expect(rows(morgan)).toHaveCount(1);
    await expect(rows(morgan).first()).toContainText('Alex Employee');
    await expect(morgan.getByText('Taylor')).toHaveCount(0);
    await expect(cell(morgan.getByTestId('report-totals'), 'Total hours')).toHaveText('8.00');

    await openReport(riley, week);
    await expect(rows(riley)).toHaveCount(1);
    await expect(rows(riley).first()).not.toContainText('Alex');
    await expect(cell(riley.getByTestId('report-totals'), 'Total hours')).toHaveText('4.00');

    await openReport(admin, week);
    await expect(rows(admin)).toHaveCount(2);
    await expect(cell(admin.getByTestId('report-totals'), 'Total hours')).toHaveText('12.00');
    await expect(cell(admin.getByTestId('report-totals'), 'People')).toHaveText('2');

    // Asking for someone else's hours by id does not work around the scope.
    const taylorId = (await (await taylor.page.request.get(`${API}/auth/me`)).json()).id;
    const probe = await morgan.request.get(
      `${API}/reports/hours?date_from=${week}&date_to=${dayOf(week, 6)}&employee_id=${taylorId}`,
    );
    expect(probe.status()).toBe(200);
    expect((await probe.json()).items).toEqual([]);

    // Employees have no link, no page and no API.
    await employee.goto('/');
    await expect(employee.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await employee.goto('/reports');
    await expect(
      employee.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
    const refused = await employee.request.get(
      `${API}/reports/hours?date_from=${week}&date_to=${dayOf(week, 6)}`,
    );
    expect(refused.status()).toBe(403);
    expect(
      (
        await employee.request.get(`${API}/reports/hours.csv?date_from=${week}&date_to=${week}`)
      ).status(),
    ).toBe(403);
    await taylor.context.close();
    await sam.context.close();
  });

  test('an impossible range is explained and nothing is requested', async ({
    managerPage: manager,
  }) => {
    const calls: string[] = [];
    manager.on('request', (request) => {
      if (request.url().includes('/reports/hours')) calls.push(request.url());
    });
    await manager.goto('/reports?from=2027-03-10&to=2027-03-01');
    await expect(manager.getByRole('alert')).toContainText(
      'The start date must not be after the end date.',
    );
    await manager.goto('/reports?from=2025-01-01&to=2027-03-01');
    await expect(manager.getByRole('alert')).toContainText('at most 366 days');
    await expect(manager.getByTestId('report-table')).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test('default range ends today; empty results say so', async ({ managerPage: manager }) => {
    await manager.goto('/reports');
    const today = (await (await manager.request.get(`${API}/meta`)).json()).today;
    await expect(manager.getByLabel('To')).toHaveValue(today);
    await expect(manager.getByLabel('From')).not.toHaveValue('');
    await manager.goto('/reports?from=2031-01-01&to=2031-01-31');
    await expect(manager.getByText('No hours in this range')).toBeVisible();
    await expect(manager.getByRole('link', { name: 'Download CSV' })).toHaveCount(0);
  });

  test('passes axe with data, and is readable on a phone', async ({
    employeePage: employee,
    managerPage: manager,
    browser,
    baseURL,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'rep-a11y',
      testInfo.project.name,
      testInfo.retry,
    );
    await approveWeek(employee, manager, week, [
      { offset: 0, hours: '8', earning: 'REG', project: 'PRJ-001', task: 'DEV' },
    ]);
    await openReport(manager, week);
    await expect(rows(manager)).toHaveCount(1);
    await expectNoAxeViolations(manager);

    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
    await signInViaApi(context.request, MANAGER);
    const phone = await context.newPage();
    await openReport(phone, week);
    const row = rows(phone).first();
    await expect(row).toBeVisible();
    await expect(cell(row, 'Total hours')).toBeVisible(); // every figure keeps its label
    expect(
      await phone.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(phone);
    await context.close();
  });
});
