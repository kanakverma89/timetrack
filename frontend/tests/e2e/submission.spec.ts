import type { Locator, Page } from '@playwright/test';
import {
  API,
  CSRF,
  EMPLOYEE,
  EMPLOYEE2,
  createEntryViaApi,
  dayOf,
  expect,
  expectNoAxeViolations,
  getWeek,
  isolatedWeek,
  openWeek,
  refs,
  setWeekStatus,
  signInViaApi,
  test,
} from './fixtures';

const submitButton = (page: Page) => page.getByRole('button', { name: /^(Submit|Resubmit) week$/ });
const dialog = (page: Page): Locator => page.getByRole('alertdialog');
const summary = (page: Page) => page.getByRole('region', { name: 'Weekly summary' });

async function openSubmitDialog(page: Page, name = 'Submit week') {
  await page.getByRole('button', { name }).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}

async function expectLocked(page: Page) {
  for (const name of [/^Add entry$/, /^Edit entry/, /^Delete entry/, /^(Submit|Resubmit) week$/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
}

test.describe('Weekly submission', () => {
  test('submits a valid week: confirmation, Submitted status, and the week becomes read-only', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'submit', testInfo.project.name, testInfo.retry);
    await createEntryViaApi(page.request, {
      work_date: week,
      hours: '8',
      description: 'Monday work',
    });
    await createEntryViaApi(page.request, {
      work_date: dayOf(week, 1),
      hours: '6.5',
      description: 'Tuesday work',
    });
    await openWeek(page, week);
    await expect(summary(page)).toContainText('Draft');

    const confirm = await openSubmitDialog(page);
    await expect(confirm).toHaveAccessibleName('Submit this week?');
    await expect(confirm).toContainText('2 entries');
    await expect(confirm).toContainText('14.50 hours');
    await expect(confirm).toContainText('can no longer be added, changed or deleted');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByLabel(/Comment for your manager/).fill('Ready for review');
    await confirm.getByRole('button', { name: 'Submit week' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Week submitted for approval.' }),
    ).toBeVisible();
    await expect(summary(page)).toContainText('Submitted');
    await expect(page.getByText(/This week is submitted and read-only\. Submitted /)).toBeVisible();
    await expectLocked(page);
    // Everything is still readable and unchanged.
    await expect(page.getByTestId('entry-card')).toHaveCount(2);
    await expect(page.getByTestId('total-hours')).toHaveText('14.50');
    await expect(page.getByTestId('draft-count')).toHaveText('0');

    const data = await getWeek(page.request, week);
    expect(data.status).toBe('SUBMITTED');
    expect(data.is_editable).toBe(false);
    expect(new Date(data.submitted_at).getTime()).toBeGreaterThan(Date.now() - 120_000);
    await page.reload();
    await expect(summary(page)).toContainText('Submitted');
    await expectLocked(page);
  });

  test('a submitted week refuses every change at the API as well', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-api',
      testInfo.project.name,
      testInfo.retry,
    );
    const entry = await createEntryViaApi(page.request, { work_date: week, hours: '8' });
    const r = await refs(page.request);
    const body = {
      work_date: dayOf(week, 1),
      hours: '1',
      earning_code_id: r.earning('REG'),
      project_id: r.project('PRJ-003'),
      description: 'too late',
    };
    expect(
      (
        await page.request.post(`${API}/timesheets/weeks/${week}/submit`, {
          headers: CSRF,
          data: {},
        })
      ).status(),
    ).toBe(200);

    const attempts = [
      page.request.post(`${API}/time-entries`, { headers: CSRF, data: body }),
      page.request.post(`${API}/time-entries/batch`, { headers: CSRF, data: { entries: [body] } }),
      page.request.patch(`${API}/time-entries/${entry.id}`, {
        headers: CSRF,
        data: { hours: '2' },
      }),
      page.request.delete(`${API}/time-entries/${entry.id}`, { headers: CSRF }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status()).toBe(409);
      expect((await response.json()).error.code).toBe('WEEK_NOT_EDITABLE');
    }
    const data = await getWeek(page.request, week);
    expect(data.entries).toHaveLength(1);
    expect(data.summary.total_hours).toBe('8.00');
  });

  test('cancelling the confirmation submits nothing', async ({ employeePage: page }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-cancel',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(page.request, { work_date: week });
    await openWeek(page, week);
    const confirm = await openSubmitDialog(page);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(submitButton(page)).toBeFocused();
    expect((await getWeek(page.request, week)).status).toBe('DRAFT');
    await expect(page.getByRole('button', { name: /^Add entry$/ })).toBeVisible();
  });

  test('an empty week cannot be submitted in the UI or the API', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-empty',
      testInfo.project.name,
      testInfo.retry,
    );
    await openWeek(page, week);
    const button = page.getByRole('button', { name: 'Submit week' });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription('Add at least one entry to submit.');

    const response = await page.request.post(`${API}/timesheets/weeks/${week}/submit`, {
      headers: CSRF,
      data: {},
    });
    expect(response.status()).toBe(422);
    expect((await response.json()).error.field_errors.entries).toMatch(/at least one/);
    const data = await getWeek(page.request, week);
    expect(data.id).toBeNull(); // submitting must not even create the week
    expect(data.status).toBe('DRAFT');
  });

  test('double-clicking the confirm button submits exactly once, without an error', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-double',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(page.request, { work_date: week });
    const posts: string[] = [];
    page.on('request', (r) => r.url().endsWith('/submit') && posts.push(r.method()));
    await openWeek(page, week);
    const confirm = await openSubmitDialog(page);
    await confirm.getByRole('button', { name: 'Submit week' }).dblclick();

    await expect(summary(page)).toContainText('Submitted');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(posts).toHaveLength(1); // the second click hit a disabled button
    expect((await getWeek(page.request, week)).status).toBe('SUBMITTED');
  });

  test('retries with the same Idempotency-Key succeed; other duplicates are conflicts', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-api',
      testInfo.project.name,
      testInfo.retry,
    );
    // submit-api is also used by the locked-week test; use the next week for this one.
    const second = dayOf(week, 7);
    await createEntryViaApi(page.request, { work_date: second });
    const post = (key?: string, day = second) =>
      page.request.post(`${API}/timesheets/weeks/${day}/submit`, {
        headers: { ...CSRF, ...(key ? { 'Idempotency-Key': key } : {}) },
        data: {},
      });
    const key = `retry-${testInfo.project.name}-${testInfo.retry}-0001`;

    const first = await post(key);
    expect(first.status()).toBe(200);
    const again = await post(key); // the "lost response" retry
    expect(again.status()).toBe(200);
    expect((await again.json()).submitted_at).toBe((await first.json()).submitted_at);

    const other = await post(`other-${key}`); // a different action on a submitted week
    expect(other.status()).toBe(409);
    expect((await other.json()).error.code).toBe('INVALID_TRANSITION');
    expect((await post()).status()).toBe(409);

    // The key belongs to that week; malformed keys are refused outright.
    const reused = await post(key, week);
    expect(reused.status()).toBe(422);
    expect((await reused.json()).error.field_errors['Idempotency-Key']).toBeTruthy();
    expect((await post('bad key!')).status()).toBe(422);
  });
});

test.describe('Weekly policy at submission', () => {
  test('daily and weekly limits are explained, the week stays editable, and fixing it works', async ({
    employeePage: page,
  }, testInfo) => {
    // The E2E server enforces MAX_HOURS_PER_DAY=16 and MAX_HOURS_PER_WEEK=60 (playwright.config).
    const week = await isolatedWeek(
      page.request,
      'submit-policy',
      testInfo.project.name,
      testInfo.retry,
    );
    const tue = dayOf(week, 1);
    await createEntryViaApi(page.request, {
      work_date: tue,
      hours: '9',
      description: 'Morning block',
    });
    const extra = await createEntryViaApi(page.request, {
      work_date: tue,
      hours: '8',
      description: 'Evening block',
    });
    await openWeek(page, week);

    let confirm = await openSubmitDialog(page);
    await confirm.getByRole('button', { name: 'Submit week' }).click();
    const alert = confirm.getByRole('alert');
    await expect(alert).toContainText('This week cannot be submitted yet.');
    await expect(alert).toContainText(
      'Total for this day is 17.00 h, above the daily limit of 16.00 h.',
    );
    await expect(alert.getByRole('listitem').first()).toContainText('Tuesday');
    expect((await getWeek(page.request, week)).status).toBe('DRAFT');

    // Fix the day, then break the weekly limit instead: 4 x 14h + 9h = 65h.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(
      (await page.request.delete(`${API}/time-entries/${extra.id}`, { headers: CSRF })).status(),
    ).toBe(204);
    for (const offset of [2, 3, 4, 5]) {
      await createEntryViaApi(page.request, { work_date: dayOf(week, offset), hours: '14' });
    }
    await page.reload();
    confirm = await openSubmitDialog(page);
    await confirm.getByRole('button', { name: 'Submit week' }).click();
    await expect(confirm.getByRole('alert')).toContainText(
      'Total for the week is 65.00 h, above the weekly limit of 60.00 h.',
    );
    await expect(confirm.getByRole('alert')).not.toContainText('daily limit');

    // Bring the week under the limit; the very same flow now succeeds.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    const { entries } = await getWeek(page.request, week);
    const fourteen = entries.find((e: { hours: string }) => e.hours === '14.00');
    await page.request.delete(`${API}/time-entries/${fourteen.id}`, { headers: CSRF });
    await page.reload();
    confirm = await openSubmitDialog(page);
    await confirm.getByRole('button', { name: 'Submit week' }).click();
    await expect(summary(page)).toContainText('Submitted');
  });
});

test.describe('Resubmission', () => {
  test('a rejected week shows the reason, stays editable, and can be resubmitted', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-resubmit',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(page.request, { work_date: week, hours: '8' });
    setWeekStatus(EMPLOYEE, week, 'REJECTED', 'Please correct the hours recorded for Tuesday.');
    await openWeek(page, week);

    await expect(page.getByText(/This week was rejected\./)).toBeVisible();
    await expect(page.getByText('Please correct the hours recorded for Tuesday.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add entry' })).toBeVisible(); // still editable
    await expect(page.getByRole('button', { name: 'Submit week', exact: true })).toHaveCount(0);

    // Fix something, then resubmit.
    await createEntryViaApi(page.request, { work_date: dayOf(week, 1), hours: '2' });
    await page.reload();
    const confirm = await openSubmitDialog(page, 'Resubmit week');
    await expect(confirm).toHaveAccessibleName('Resubmit this week?');
    await confirm.getByRole('button', { name: 'Resubmit week' }).click();

    await expect(summary(page)).toContainText('Submitted');
    await expect(page.getByText(/This week was rejected\./)).toHaveCount(0);
    await expectLocked(page);
    const data = await getWeek(page.request, week);
    expect(data.status).toBe('SUBMITTED');
    expect(data.review_comment).toBeNull();
  });

  test('an approved week cannot be submitted again and shows no controls', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-isolation',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(page.request, { work_date: week, hours: '8' });
    setWeekStatus(EMPLOYEE, week, 'APPROVED', 'Looks good.');
    await openWeek(page, week);
    await expect(summary(page)).toContainText('Approved');
    await expect(page.getByText(/This week is approved and read-only\./)).toBeVisible();
    await expectLocked(page);
    const response = await page.request.post(`${API}/timesheets/weeks/${week}/submit`, {
      headers: CSRF,
      data: {},
    });
    expect(response.status()).toBe(409);
  });
});

test.describe('Isolation', () => {
  test("another employee cannot submit, or even see, someone else's week", async ({
    employeePage: page,
    playwright,
    baseURL,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-isolation',
      testInfo.project.name,
      testInfo.retry + 1,
    );
    await createEntryViaApi(page.request, { work_date: week, hours: '8' });

    const other = await playwright.request.newContext({ baseURL });
    await signInViaApi(other, EMPLOYEE2);
    const response = await other.post(`${API}/timesheets/weeks/${week}/submit`, {
      headers: CSRF,
      data: {},
    });
    expect(response.status()).toBe(422); // they have nothing of their own in that week
    expect((await getWeek(other, week)).entries).toHaveLength(0);
    await other.dispose();

    expect((await getWeek(page.request, week)).status).toBe('DRAFT');
  });
});

test.describe('Submission accessibility and layout', () => {
  test('the dialog (also with errors) has no axe violations, and Escape returns focus', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-a11y',
      testInfo.project.name,
      testInfo.retry,
    );
    const tue = dayOf(week, 1);
    await createEntryViaApi(page.request, { work_date: tue, hours: '9' });
    await createEntryViaApi(page.request, { work_date: tue, hours: '9', description: 'More' });
    await openWeek(page, week);
    await expectNoAxeViolations(page);

    const button = page.getByRole('button', { name: 'Submit week' });
    await button.focus();
    await page.keyboard.press('Enter'); // keyboard activation opens the dialog
    const confirm = dialog(page);
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expectNoAxeViolations(page);

    await confirm.getByRole('button', { name: 'Submit week' }).click();
    await expect(confirm.getByRole('alert')).toContainText('daily limit');
    await expectNoAxeViolations(page);

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('works on a 375px screen without sideways scrolling', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(
      page.request,
      'submit-mobile',
      testInfo.project.name,
      testInfo.retry,
    );
    await createEntryViaApi(page.request, { work_date: week, hours: '8' });
    await page.setViewportSize({ width: 375, height: 667 });
    await openWeek(page, week);
    // On a phone the action sits below the day cards; it must be reachable by scrolling.
    const button = page.getByRole('button', { name: 'Submit week' });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    const confirm = await openSubmitDialog(page);
    const box = await confirm.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await expect(confirm.getByRole('button', { name: 'Submit week' })).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await confirm.getByRole('button', { name: 'Submit week' }).click();
    await expect(summary(page)).toContainText('Submitted');
    await expectNoAxeViolations(page);
  });
});
