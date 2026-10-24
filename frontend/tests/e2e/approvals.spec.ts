import type { Page } from '@playwright/test';
import {
  API,
  CSRF,
  EMPLOYEE3,
  MANAGER,
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

const REASON = 'Please correct the hours recorded for Tuesday.';

/** Open the approvals page already narrowed to one week, so paging never hides the row. */
async function openQueue(page: Page, week: string, status = 'SUBMITTED') {
  await page.goto(`/approvals?status=${status}&week=${week}`);
}

const rowFor = (page: Page, employee: string, week: string) =>
  page
    .getByTestId('approval-row')
    .filter({ hasText: employee })
    .filter({ hasText: rangeLabel(week) });

async function openReview(page: Page, employee: string, week: string) {
  await openQueue(page, week);
  await rowFor(page, employee, week)
    .getByRole('link', { name: /^Review / })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(employee);
}

const dialog = (page: Page) => page.getByRole('alertdialog');
const banner = (page: Page) => page.getByRole('status').filter({ hasText: /This week/ });

test.describe('Manager and employee workflow', () => {
  test('submit → review → approve, seen from both sides', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-flow',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(employee.request, {
      work_date: week,
      hours: '8',
      description: 'Planning day',
    });
    await createEntryViaApi(employee.request, {
      work_date: dayOf(week, 1),
      hours: '6.5',
      description: 'Build day',
    });

    // The employee submits through the UI, with a note.
    await openWeek(employee, week);
    await employee.getByRole('button', { name: 'Submit week' }).click();
    await dialog(employee)
      .getByLabel(/Comment for your manager/)
      .fill('Please review this week');
    await dialog(employee).getByRole('button', { name: 'Submit week' }).click();
    await expect(employee.getByText(/This week is submitted and read-only/)).toBeVisible();

    // The manager finds it in the queue by filtering to that week.
    await manager.goto('/approvals');
    await manager.getByLabel(/Week containing/).fill(week);
    const row = rowFor(manager, 'Alex Employee', week);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('14.50');
    await expect(row).toContainText('Submitted');
    await row.getByRole('link', { name: /^Review / }).click();

    // Everything needed to decide is on one page.
    await expect(manager.getByRole('heading', { level: 1 })).toContainText('Alex Employee');
    await expect(manager.getByRole('group', { name: 'Decision' })).toContainText(
      'Total 14.50 hours',
    );
    await expect(manager.locator('blockquote.employee-note')).toContainText(
      'Please review this week',
    );
    await expect(manager.getByTestId('entry-card')).toHaveCount(2);
    await expect(manager.getByTestId('total-hours')).toHaveText('14.50');
    await expect(manager.getByRole('button', { name: /^(Edit|Delete) entry/ })).toHaveCount(0); // read-only
    await expect(
      manager.getByRole('listitem').filter({ hasText: 'Submitted by Alex Employee' }),
    ).toBeVisible();

    await manager.getByRole('button', { name: 'Approve' }).click();
    const confirm = dialog(manager);
    await expect(confirm).toHaveAccessibleName('Approve this week?');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByLabel(/Comment for the employee/).fill('Looks good');
    await confirm.getByRole('button', { name: 'Approve week' }).click();

    await expect(manager.getByRole('status').filter({ hasText: 'Week approved.' })).toBeVisible();
    await expect(banner(manager)).toContainText('This week was approved by Morgan Manager');
    await expect(banner(manager)).toContainText('Comment: Looks good');
    await expect(manager.getByRole('button', { name: /^(Approve|Reject)$/ })).toHaveCount(0);
    await expect(manager.locator('.history-item')).toHaveCount(2);

    // It left the waiting queue and is now under Approved, with the reviewer named.
    await openQueue(manager, week);
    await expect(manager.getByText('Nothing is waiting for your review.')).toBeVisible();
    await openQueue(manager, week, 'APPROVED');
    await expect(rowFor(manager, 'Alex Employee', week)).toContainText('by Morgan Manager');

    // The employee sees the decision, who made it, and cannot change anything.
    await employee.reload();
    await expect(employee.getByText(/This week is approved and read-only\./)).toBeVisible();
    await expect(employee.getByText(/Reviewed by Morgan Manager/)).toBeVisible();
    await expect(employee.getByText('Comment: Looks good')).toBeVisible();
    for (const name of [/Add entry/, /^Edit entry/, /^Delete entry/, /submit week/i]) {
      await expect(employee.getByRole('button', { name })).toHaveCount(0);
    }
    expect((await getWeek(employee.request, week)).status).toBe('APPROVED');
  });

  test('reject with a reason → employee fixes and resubmits → approved, with the full history', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-cycle',
      testInfo.project.name,
      testInfo.retry,
    );
    await submittedWeek(employee.request, week, { hours: '8', comment: 'First attempt' });

    await openReview(manager, 'Alex Employee', week);
    await manager.getByRole('button', { name: 'Reject' }).click();
    const confirm = dialog(manager);
    await expect(confirm).toHaveAccessibleName('Reject this week?');

    // A reason is mandatory and must say something.
    await confirm.getByRole('button', { name: 'Reject week' }).click();
    await expect(confirm.getByRole('alert')).toContainText('at least 5 characters');
    await confirm.getByLabel(/Reason for rejection/).fill('no');
    await confirm.getByRole('button', { name: 'Reject week' }).click();
    await expect(confirm.getByRole('alert')).toContainText('at least 5 characters');
    expect((await getWeek(employee.request, week)).status).toBe('SUBMITTED'); // nothing happened yet

    await confirm.getByLabel(/Reason for rejection/).fill(REASON);
    await confirm.getByRole('button', { name: 'Reject week' }).click();
    await expect(
      manager
        .getByRole('status')
        .filter({ hasText: 'Week rejected and returned to the employee.' }),
    ).toBeVisible();
    await expect(banner(manager)).toContainText(`Reason: ${REASON}`);

    // The employee sees why, and can correct the week.
    await openWeek(employee, week);
    await expect(employee.getByText('This week was rejected.')).toBeVisible();
    await expect(employee.getByText(`Reason: ${REASON}`)).toBeVisible();
    await expect(employee.getByText(/Reviewed by Morgan Manager/)).toBeVisible();
    await expect(employee.getByRole('button', { name: 'Add entry' })).toBeVisible();
    await createEntryViaApi(employee.request, {
      work_date: dayOf(week, 1),
      hours: '2',
      description: 'The missing Tuesday hours',
    });
    await employee.reload();
    await employee.getByRole('button', { name: 'Resubmit week' }).click();
    await dialog(employee)
      .getByLabel(/Comment for your manager/)
      .fill('Added Tuesday');
    await dialog(employee).getByRole('button', { name: 'Resubmit week' }).click();
    await expect(employee.getByText(/This week is submitted and read-only/)).toBeVisible();
    await expect(employee.getByText('This week was rejected.')).toHaveCount(0);

    // Back in the manager's queue; approve it. The history keeps every step in order.
    await openReview(manager, 'Alex Employee', week);
    await expect(manager.getByTestId('entry-card')).toHaveCount(2);
    await manager.getByRole('button', { name: 'Approve' }).click();
    await dialog(manager).getByRole('button', { name: 'Approve week' }).click();
    await expect(banner(manager)).toContainText('This week was approved');

    const items = manager.locator('.history-item');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('Submitted by Alex Employee');
    await expect(items.nth(0)).toContainText('First attempt');
    await expect(items.nth(1)).toContainText('Rejected by Morgan Manager');
    await expect(items.nth(1)).toContainText(REASON);
    await expect(items.nth(2)).toContainText('Submitted by Alex Employee');
    await expect(items.nth(2)).toContainText('Added Tuesday');
    await expect(items.nth(3)).toContainText('Approved by Morgan Manager');
  });
});

test.describe('Who can see and decide what', () => {
  test('a manager only ever sees their own reports; another manager and the admin differ', async ({
    employeePage: employee,
    managerPage: morgan,
    manager2Page: riley,
    adminPage: admin,
    playwright,
    baseURL,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-scope',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week, { description: 'Alex only' });

    // Morgan (Alex's manager) and the admin see it; Riley (manager of someone else) does not.
    await openQueue(morgan, week);
    await expect(rowFor(morgan, 'Alex Employee', week)).toHaveCount(1);
    await openQueue(admin, week);
    await expect(rowFor(admin, 'Alex Employee', week)).toHaveCount(1);
    await openQueue(riley, week);
    await expect(riley.getByText('Nothing is waiting for your review.')).toBeVisible();
    await expect(riley.getByTestId('approval-row')).toHaveCount(0);

    // Riley opening the URL directly learns nothing: the same "not found" as a made-up id.
    await riley.goto(`/approvals/${weekId}`);
    await expect(riley.getByRole('heading', { name: 'Timesheet not found' })).toBeVisible();
    await riley.goto('/approvals/00000000-0000-4000-8000-000000000999');
    await expect(riley.getByRole('heading', { name: 'Timesheet not found' })).toBeVisible();

    // Same at the API, for reading and for deciding, and the week stays untouched.
    const rileyApi = riley.request;
    const attempts = [
      rileyApi.get(`${API}/approvals/${weekId}`),
      rileyApi.post(`${API}/approvals/${weekId}/approve`, { headers: CSRF, data: {} }),
      rileyApi.post(`${API}/approvals/${weekId}/reject`, {
        headers: CSRF,
        data: { comment: REASON },
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status()).toBe(404);
      expect((await response.json()).error.code).toBe('NOT_FOUND');
    }
    expect((await getWeek(employee.request, week)).status).toBe('SUBMITTED');

    // Riley's own report (Taylor) is invisible to Morgan, but present for Riley.
    const taylorQueue = await riley.request.get(`${API}/approvals?week_start_date=2026-10-05`);
    expect(
      (await taylorQueue.json()).items.map(
        (i: { employee: { email: string } }) => i.employee.email,
      ),
    ).toEqual([EMPLOYEE3]);
    const morganSeesTaylor = await morgan.request.get(
      `${API}/approvals?week_start_date=2026-10-05`,
    );
    expect(
      (await morganSeesTaylor.json()).items.some(
        (i: { employee: { email: string } }) => i.employee.email === EMPLOYEE3,
      ),
    ).toBe(false);

    // Nobody is anonymous.
    const anonymous = await playwright.request.newContext({ baseURL });
    expect((await anonymous.get(`${API}/approvals`)).status()).toBe(401);
    await anonymous.dispose();
  });

  test('an employee has no approvals page, link or API access', async ({
    employeePage: employee,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-own',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week);
    await employee.goto('/approvals');
    await expect(employee.getByRole('heading', { name: /do not have access/i })).toBeVisible();
    await expect(employee.getByRole('link', { name: /Approvals/ })).toHaveCount(0);
    await expect(employee.getByRole('link', { name: 'Timesheet', exact: true })).toBeVisible();

    for (const response of [
      await employee.request.get(`${API}/approvals`),
      await employee.request.get(`${API}/approvals/${weekId}`),
      await employee.request.post(`${API}/approvals/${weekId}/approve`, {
        headers: CSRF,
        data: {},
      }),
    ]) {
      expect(response.status()).toBe(403);
      expect((await response.json()).error.code).toBe('FORBIDDEN');
    }
    expect((await getWeek(employee.request, week)).status).toBe('SUBMITTED');
  });

  test('nobody can review their own week, not even an administrator', async ({
    adminPage: admin,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      admin.request,
      'appr-own',
      testInfo.project.name,
      testInfo.retry + 1,
    );
    const adminWeek = await submittedWeek(admin.request, week, { description: 'Admin own' });
    const managerWeek = await submittedWeek(manager.request, week, { description: 'Manager own' });

    for (const [who, weekId] of [
      [admin, adminWeek],
      [manager, managerWeek],
    ] as const) {
      expect((await who.request.get(`${API}/approvals/${weekId}`)).status()).toBe(403);
      expect(
        (
          await who.request.post(`${API}/approvals/${weekId}/approve`, { headers: CSRF, data: {} })
        ).status(),
      ).toBe(403);
      expect(
        (
          await who.request.post(`${API}/approvals/${weekId}/reject`, {
            headers: CSRF,
            data: { comment: REASON },
          })
        ).status(),
      ).toBe(403);
      await who.goto(`/approvals/${weekId}`);
      await expect(
        who.getByRole('heading', { name: 'You cannot review this timesheet' }),
      ).toBeVisible();
    }
    // Their own weeks are not in their own queue either.
    await openQueue(admin, week);
    await expect(admin.getByText(/Admin own/)).toHaveCount(0);
    expect((await getWeek(admin.request, week)).status).toBe('SUBMITTED');
  });

  test('draft weeks are never visible to a manager', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-draft',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(employee.request, {
      work_date: week,
      hours: '8',
      description: 'Still working on it',
    });
    const draftId = (await getWeek(employee.request, week)).id;
    await openQueue(manager, week);
    await expect(manager.getByTestId('approval-row')).toHaveCount(0);
    expect((await manager.request.get(`${API}/approvals/${draftId}`)).status()).toBe(404);
    expect(
      (
        await manager.request.post(`${API}/approvals/${draftId}/approve`, {
          headers: CSRF,
          data: {},
        })
      ).status(),
    ).toBe(404);
    expect((await manager.request.get(`${API}/approvals?status=DRAFT`)).status()).toBe(422);
    expect((await getWeek(employee.request, week)).status).toBe('DRAFT');
  });

  test('a decided week cannot be decided again; the UI stops offering it', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-twice',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week);
    expect(
      (
        await manager.request.post(`${API}/approvals/${weekId}/approve`, {
          headers: CSRF,
          data: {},
        })
      ).status(),
    ).toBe(200);

    for (const response of [
      await manager.request.post(`${API}/approvals/${weekId}/approve`, { headers: CSRF, data: {} }),
      await manager.request.post(`${API}/approvals/${weekId}/reject`, {
        headers: CSRF,
        data: { comment: REASON },
      }),
    ]) {
      expect(response.status()).toBe(409);
      expect((await response.json()).error.code).toBe('INVALID_TRANSITION');
    }
    await manager.goto(`/approvals/${weekId}`);
    await expect(manager.getByRole('button', { name: /^(Approve|Reject)$/ })).toHaveCount(0);
    expect((await getWeek(employee.request, week)).status).toBe('APPROVED');
    // The audit trail has exactly one decision.
    const detail = await (await manager.request.get(`${API}/approvals/${weekId}`)).json();
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual([
      'SUBMITTED',
      'APPROVED',
    ]);
  });
});

test.describe('Safety under real-world mishaps', () => {
  test('double-clicking Approve decides exactly once', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-double',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week);
    const posts: string[] = [];
    manager.on(
      'request',
      (r) => r.method() === 'POST' && r.url().includes('/approve') && posts.push(r.url()),
    );
    await manager.goto(`/approvals/${weekId}`);
    await manager.getByRole('button', { name: 'Approve' }).click();
    await dialog(manager).getByRole('button', { name: 'Approve week' }).dblclick();
    await expect(banner(manager)).toContainText('This week was approved');
    await expect(manager.getByRole('alert')).toHaveCount(0);
    expect(posts).toHaveLength(1);
    const detail = await (await manager.request.get(`${API}/approvals/${weekId}`)).json();
    expect(detail.history.filter((h: { action: string }) => h.action === 'APPROVED')).toHaveLength(
      1,
    );
  });

  test('when two reviewers act on the same week, the second is told and sees the real outcome', async ({
    employeePage: employee,
    managerPage: morgan,
    adminPage: admin,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-conflict',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week);

    // Both open the same review and start deciding...
    await morgan.goto(`/approvals/${weekId}`);
    await admin.goto(`/approvals/${weekId}`);
    await morgan.getByRole('button', { name: 'Approve' }).click();
    await admin.getByRole('button', { name: 'Reject' }).click();
    await admin.getByLabel(/Reason for rejection/).fill('Hours look too high for this week');

    // ...Morgan confirms first.
    await dialog(morgan).getByRole('button', { name: 'Approve week' }).click();
    await expect(banner(morgan)).toContainText('This week was approved by Morgan Manager');

    // The admin's later decision is refused with an explanation; nothing is overwritten.
    await dialog(admin).getByRole('button', { name: 'Reject week' }).click();
    await expect(dialog(admin).getByRole('alert')).toContainText(
      'only a submitted week can be rejected',
    );
    await dialog(admin).getByRole('button', { name: 'Cancel' }).click();
    await expect(banner(admin)).toContainText('This week was approved by Morgan Manager');
    await expect(admin.getByRole('button', { name: /^(Approve|Reject)$/ })).toHaveCount(0);
    expect((await getWeek(employee.request, week)).status).toBe('APPROVED');
  });
});

test.describe('List behaviour', () => {
  test('filters by status and week, pages through a long queue, and orders oldest first', async ({
    managerPage: manager,
    manager2Page: riley,
    browserName,
  }, testInfo) => {
    // Taylor reports to Riley and to nobody else's tests, so this queue is ours to fill. Each
    // browser project uses its own run of weeks so parallel browsers never collide.
    const taylor = await riley
      .context()
      .browser()!
      .newContext({ baseURL: testInfo.project.use.baseURL });
    await signInViaApi(taylor.request, EMPLOYEE3);
    const slot = ['chromium', 'firefox', 'webkit'].indexOf(browserName) * 30 + testInfo.retry * 90;
    const base = Date.UTC(2040, 0, 2) + slot * 7 * 86_400_000; // a Monday
    const weeks = Array.from({ length: 12 }, (_, i) =>
      new Date(base + i * 7 * 86_400_000).toISOString().slice(0, 10),
    );
    const ids: string[] = [];
    for (const week of weeks)
      ids.push(await submittedWeek(taylor.request, week, { description: 'Bulk' }));
    await taylor.close();

    // API: paging is complete, ordered by submission time, with no repeats.
    const fetched: string[] = [];
    for (let page = 1; page <= 20; page++) {
      const body = await (
        await riley.request.get(`${API}/approvals?page=${page}&page_size=5`)
      ).json();
      fetched.push(...body.items.map((i: { week_id: string }) => i.week_id));
      if (body.items.length < 5) break;
    }
    expect(new Set(fetched).size).toBe(fetched.length);
    expect(fetched.filter((id) => ids.includes(id))).toEqual(ids); // ours, in submission order

    // UI: at least two pages; Next/Previous work and the page indicator is accurate.
    await riley.goto('/approvals');
    await expect(riley.getByTestId('approval-row')).toHaveCount(10);
    await expect(riley.getByText(/^Page 1 of \d+ ·/)).toBeVisible();
    await expect(riley.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await riley.getByRole('button', { name: 'Next page' }).click();
    await expect(riley.getByText(/^Page 2 of \d+ ·/)).toBeVisible();
    await expect(riley.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    await riley.getByRole('button', { name: 'Previous page' }).click();
    await expect(riley.getByText(/^Page 1 of \d+ ·/)).toBeVisible();

    // Week filter narrows to exactly one row; status filter swaps the list.
    await riley.getByLabel(/Week containing/).fill(dayOf(weeks[3] as string, 2));
    await expect(riley.getByTestId('approval-row')).toHaveCount(1);
    await expect(riley.getByTestId('approval-row')).toContainText(rangeLabel(weeks[3] as string));
    await riley.getByLabel('Show').selectOption('REJECTED');
    await expect(riley.getByText('No rejected timesheets match.')).toBeVisible();
    await riley.getByRole('button', { name: 'Clear week' }).click();

    // Morgan never sees any of Taylor's weeks.
    const morgan = await (await manager.request.get(`${API}/approvals?page_size=100`)).json();
    expect(morgan.items.some((i: { week_id: string }) => ids.includes(i.week_id))).toBe(false);
  });

  test('shows the number waiting in the navigation', async ({ managerPage: manager }) => {
    await manager.goto('/approvals');
    const link = manager
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: /^Approvals/ });
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(link).toHaveAccessibleName(/^Approvals \d+ waiting for review$/); // seed has one waiting
  });
});

test.describe('Approvals accessibility and layout', () => {
  test('list, review page and both dialogs have no axe violations; Escape returns focus', async ({
    employeePage: employee,
    managerPage: manager,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-a11y',
      testInfo.project.name,
      testInfo.retry,
    );
    const weekId = await submittedWeek(employee.request, week, { comment: 'For review' });
    await openQueue(manager, week);
    await expect(manager.getByTestId('approval-row')).toHaveCount(1);
    await expectNoAxeViolations(manager);

    await manager.goto(`/approvals/${weekId}`);
    await expect(manager.getByRole('group', { name: 'Decision' })).toBeVisible();
    await expectNoAxeViolations(manager);

    const reject = manager.getByRole('button', { name: 'Reject' });
    await reject.focus();
    await manager.keyboard.press('Enter');
    await expect(dialog(manager)).toBeVisible();
    await expectNoAxeViolations(manager);
    await dialog(manager).getByRole('button', { name: 'Reject week' }).click(); // empty reason → error
    await expect(dialog(manager).getByRole('alert')).toBeVisible();
    await expectNoAxeViolations(manager);
    await manager.keyboard.press('Escape'); // works because focus moved to the error
    await expect(dialog(manager)).toHaveCount(0);
    await expect(reject).toBeFocused();

    await manager.getByRole('button', { name: 'Approve' }).click();
    await expectNoAxeViolations(manager);
  });

  test('keyboard-only: the table link, the decision buttons and the dialog are all reachable', async ({
    employeePage: employee,
    managerPage: manager,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      'WebKit on macOS does not Tab onto links and buttons by default',
    );
    const week = await isolatedWeek(
      employee.request,
      'appr-keyboard',
      testInfo.project.name,
      testInfo.retry,
    );
    await submittedWeek(employee.request, week);
    await openQueue(manager, week);
    const link = rowFor(manager, 'Alex Employee', week).getByRole('link', { name: /^Review / });
    await link.focus();
    await manager.keyboard.press('Enter');
    await expect(manager.getByRole('heading', { level: 1 })).toContainText('Alex Employee');
    const approve = manager.getByRole('button', { name: 'Approve' });
    await approve.focus();
    await manager.keyboard.press('Tab');
    await expect(manager.getByRole('button', { name: 'Reject' })).toBeFocused();
    await manager.keyboard.press('Enter');
    await expect(dialog(manager).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await manager.keyboard.press('Escape');
    await expect(dialog(manager)).toHaveCount(0);
    await expect(manager.getByRole('button', { name: 'Reject' })).toBeFocused();
  });

  test('works on a 375px screen: the table becomes labelled cards and nothing scrolls sideways', async ({
    employeePage: employee,
    browser,
    baseURL,
  }, testInfo) => {
    const week = await isolatedWeek(
      employee.request,
      'appr-mobile',
      testInfo.project.name,
      testInfo.retry,
    );
    await submittedWeek(employee.request, week);
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
    await signInViaApi(context.request, MANAGER);
    const phone = await context.newPage();
    await openQueue(phone, week);
    const row = rowFor(phone, 'Alex Employee', week);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-label="Hours"]')).toBeVisible(); // each cell carries its own label
    const overflow = () =>
      phone.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expectNoAxeViolations(phone);

    await row.getByRole('link', { name: /^Review / }).click();
    await expect(phone.getByRole('button', { name: 'Approve' })).toBeInViewport();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await phone.getByRole('button', { name: 'Reject' }).click();
    const box = await dialog(phone).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await expect(dialog(phone).getByRole('button', { name: 'Reject week' })).toBeInViewport();
    await phone.getByRole('button', { name: 'Cancel' }).click();
    await phone.getByRole('button', { name: 'Approve' }).click();
    await dialog(phone).getByRole('button', { name: 'Approve week' }).click();
    await expect(phone.getByText(/This week was approved/)).toBeVisible();
    await context.close();
  });
});
