import type { Locator, Page } from '@playwright/test';
import {
  API,
  CSRF,
  createEntryViaApi,
  dayOf,
  expect,
  expectNoAxeViolations,
  getWeek,
  isolatedWeek,
  openWeek,
  refs,
  test,
} from './fixtures';

const panel = (page: Page): Locator => page.getByRole('dialog', { name: /time entry/i });

const longDay = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${iso}T00:00:00Z`));

const dayInput = (p: Locator, iso: string) => p.getByLabel(`Hours for ${longDay(iso)}`);

async function openWeekMode(page: Page) {
  await page.getByRole('button', { name: 'Add entry' }).click();
  const p = panel(page);
  await expect(p).toBeVisible();
  await p.getByRole('radio', { name: /^Week/ }).check();
  await expect(p.getByRole('button', { name: 'Save entries' })).toBeVisible();
  return p;
}

async function fillShared(p: Locator, description = 'Week mode work') {
  await p.getByLabel(/^Earning code/).selectOption({ label: 'REG — Regular Work (capped)' });
  await p.getByRole('combobox', { name: /^Project/ }).click();
  await p.getByRole('option', { name: /PRJ-001/ }).click();
  await p.getByLabel(/^Task/).selectOption({ label: 'Development' });
  await p.getByLabel(/^Work description/).fill(description);
}

test.describe('Week mode', () => {
  test('creates a multi-day entry and shows the calculated total', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-create', testInfo.project.name);
    await openWeek(page, week);
    const p = await openWeekMode(page);

    // Seven rows; weekdays are on, the weekend is off and cannot take hours.
    await expect(p.getByRole('checkbox')).toHaveCount(7);
    await expect(p.getByRole('checkbox', { name: /Sat/ })).not.toBeChecked();
    await expect(dayInput(p, dayOf(week, 5))).toBeDisabled();
    await expect(p.getByTestId('week-total')).toHaveText('0.00');

    await fillShared(p);
    await dayInput(p, week).fill('8');
    await dayInput(p, dayOf(week, 1)).fill('7.5');
    await dayInput(p, dayOf(week, 2)).fill('6.25');
    await expect(p.getByTestId('week-total')).toHaveText('21.75');
    await p.getByRole('checkbox', { name: /Wed/ }).uncheck();
    await expect(p.getByTestId('week-total')).toHaveText('15.50');
    await p.getByRole('checkbox', { name: /Wed/ }).check();
    await expect(p.getByTestId('week-total')).toHaveText('21.75');

    await p.getByRole('button', { name: 'Save entries' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: '3 entries saved (21.75 hours).' }),
    ).toBeVisible();

    await expect(page.getByTestId('entry-card')).toHaveCount(3);
    await expect(page.getByTestId('total-hours')).toHaveText('21.75');
    await expect(page.getByTestId('entry-count')).toHaveText('3');
    await expect(page.getByTestId('day-card').nth(0)).toContainText('8.00');
    await expect(page.getByTestId('day-card').nth(1)).toContainText('7.50');
    await expect(page.getByTestId('day-card').nth(2)).toContainText('6.25');
    await expect(page.getByTestId('day-card').nth(3)).toContainText('0.00');

    // Stored as separate, identifiable, date-specific records that share the form's values.
    const data = await getWeek(page.request, week);
    expect(data.entries).toHaveLength(3);
    expect(new Set(data.entries.map((e: { id: string }) => e.id)).size).toBe(3);
    expect(data.entries.map((e: { work_date: string }) => e.work_date)).toEqual([
      dayOf(week, 0),
      dayOf(week, 1),
      dayOf(week, 2),
    ]);
    for (const entry of data.entries) {
      expect(entry).toMatchObject({
        description: 'Week mode work',
        project: { code: 'PRJ-001' },
        task: { code: 'DEV' },
        earning_code: { code: 'REG' },
      });
    }
    expect(data.summary.total_hours).toBe('21.75');
    await page.reload();
    await expect(page.getByTestId('entry-card')).toHaveCount(3);
  });

  test('a day left blank, at zero or switched off records nothing', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-modes', testInfo.project.name);
    await openWeek(page, week);
    const p = await openWeekMode(page);
    await fillShared(p);
    await dayInput(p, week).fill('4');
    await dayInput(p, dayOf(week, 1)).fill('0');
    await dayInput(p, dayOf(week, 3)).fill('9');
    await p.getByRole('checkbox', { name: /Thu/ }).uncheck(); // typed hours, then switched off
    await p.getByRole('button', { name: 'Save entries' }).click();
    await expect(page.getByTestId('entry-card')).toHaveCount(1);
    await expect(page.getByTestId('total-hours')).toHaveText('4.00');
  });

  test('invalid batch input is rejected by the server and nothing is partially saved', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-atomic', testInfo.project.name);
    // Corrupt the second day on its way to the server, as a hostile or buggy client could.
    let corrupt = true;
    await page.route('**/api/v1/time-entries/batch', async (route) => {
      if (!corrupt) return route.continue();
      const body = route.request().postDataJSON();
      body.entries[1].hours = '0';
      return route.continue({ postData: JSON.stringify(body) });
    });
    await openWeek(page, week);
    const p = await openWeekMode(page);
    await fillShared(p, 'Should not be saved yet');
    await dayInput(p, week).fill('8');
    await dayInput(p, dayOf(week, 1)).fill('6');
    await dayInput(p, dayOf(week, 2)).fill('4');
    await p.getByRole('button', { name: 'Save entries' }).click();

    // The failure is shown on the day that failed; everything typed is kept.
    await expect(p.getByText('Hours must be greater than zero.').first()).toBeVisible();
    await expect(dayInput(p, dayOf(week, 1))).toHaveAttribute('aria-invalid', 'true');
    await expect(dayInput(p, week)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(dayInput(p, week)).toHaveValue('8');
    await expect(dayInput(p, dayOf(week, 2))).toHaveValue('4');
    await expect(p.getByLabel(/^Work description/)).toHaveValue('Should not be saved yet');
    await expect(panel(page)).toBeVisible();

    // All-or-nothing: neither the valid days before nor after the bad one were stored, and no
    // week record was created.
    const data = await getWeek(page.request, week);
    expect(data.entries).toHaveLength(0);
    expect(data.id).toBeNull();

    // Once the problem is gone the very same form saves all three.
    corrupt = false;
    await p.getByRole('button', { name: 'Save entries' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId('entry-card')).toHaveCount(3);
    await expect(page.getByTestId('total-hours')).toHaveText('18.00');
  });

  test('client-side checks: at least one day, and per-day hour limits', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-modes', testInfo.project.name);
    const calls: string[] = [];
    page.on('request', (r) => r.method() === 'POST' && calls.push(r.url()));
    await openWeek(page, week);
    const p = await openWeekMode(page);
    await fillShared(p);

    await p.getByRole('button', { name: 'Save entries' }).click();
    await expect(p.getByRole('alert')).toContainText('Enter hours for at least one day.');

    await dayInput(p, week).fill('25');
    await dayInput(p, dayOf(week, 1)).fill('7.555');
    await p.getByRole('button', { name: 'Save entries' }).click();
    const summary = p.getByRole('alert');
    await expect(summary).toContainText('Please fix 2 fields before saving');
    await expect(summary).toContainText('Hours cannot exceed 24 per entry.');
    await expect(summary).toContainText('Hours can have at most two decimal places.');
    await summary.getByRole('link', { name: new RegExp(longDay(dayOf(week, 1))) }).click();
    await expect(dayInput(p, dayOf(week, 1))).toBeFocused();
    expect(calls.filter((u) => u.includes('/time-entries'))).toHaveLength(0);
  });

  test('switching between Day and Week mode keeps what was typed', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-modes', testInfo.project.name);
    await openWeek(page, week);
    await page.getByRole('button', { name: 'Add entry' }).click();
    const p = panel(page);
    await p.getByLabel(/^Hours/).fill('5');
    await p.getByLabel(/^Work description/).fill('Shared text');

    await p.getByRole('radio', { name: /^Week/ }).check();
    await expect(p.getByLabel(/^Work description/)).toHaveValue('Shared text');
    await dayInput(p, week).fill('3');
    await p.getByRole('checkbox', { name: /Tue/ }).uncheck();

    await p.getByRole('radio', { name: /^Day/ }).check();
    await expect(p.getByLabel(/^Hours/)).toHaveValue('5');
    await expect(p.getByLabel(/^Work description/)).toHaveValue('Shared text');
    await p.getByRole('radio', { name: /^Week/ }).check();
    await expect(dayInput(p, week)).toHaveValue('3');
    await expect(p.getByRole('checkbox', { name: /Tue/ })).not.toBeChecked();
  });

  test('never replaces existing entries and shows what is already logged', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-existing', testInfo.project.name);
    await createEntryViaApi(page.request, {
      work_date: week,
      hours: '3.00',
      description: 'Earlier',
    });
    await openWeek(page, week);
    const p = await openWeekMode(page);
    await expect(dayInput(p, week)).toHaveAccessibleDescription('Already logged: 3.00 h');
    await fillShared(p, 'Added later');
    await dayInput(p, week).fill('2');
    await dayInput(p, dayOf(week, 1)).fill('2');
    await p.getByRole('button', { name: 'Save entries' }).click();

    await expect(page.getByTestId('entry-card')).toHaveCount(3);
    await expect(page.getByTestId('day-card').nth(0)).toContainText('5.00');
    await expect(page.getByTestId('total-hours')).toHaveText('7.00');
    const descriptions = (await getWeek(page.request, week)).entries.map(
      (e: { description: string }) => e.description,
    );
    expect(descriptions).toContain('Earlier');
    expect(descriptions.filter((d: string) => d === 'Added later')).toHaveLength(2);
  });

  test('cancelling after typing in the grid asks before discarding', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-modes', testInfo.project.name);
    await openWeek(page, week);
    let p = await openWeekMode(page);
    await p.getByRole('button', { name: 'Cancel' }).click(); // only the mode changed
    await expect(panel(page)).toHaveCount(0);

    p = await openWeekMode(page);
    await dayInput(p, week).fill('2');
    await p.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dayInput(p, week)).toHaveValue('2');
  });
});

test.describe('Batch API', () => {
  test('is atomic, validates every item, and keeps one week per batch', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-api', testInfo.project.name);
    const r = await refs(page.request);
    const shared = {
      earning_code_id: r.earning('REG'),
      project_id: r.project('PRJ-003'),
      description: 'API batch',
    };
    const post = (entries: object[]) =>
      page.request.post(`${API}/time-entries/batch`, { headers: CSRF, data: { entries } });

    // One bad item (index 2) fails the lot; the error is addressed to that item.
    const bad = await post([
      { ...shared, work_date: dayOf(week, 0), hours: '1' },
      { ...shared, work_date: dayOf(week, 1), hours: '1' },
      { ...shared, work_date: dayOf(week, 2), hours: '30' },
    ]);
    expect(bad.status()).toBe(422);
    expect((await bad.json()).error.field_errors).toEqual({
      'entries.2.hours': 'Hours cannot exceed 24 per entry.',
    });
    expect((await getWeek(page.request, week)).entries).toHaveLength(0);

    // Dates from two different weeks, and a repeated date, are refused.
    const twoWeeks = await post([
      { ...shared, work_date: dayOf(week, 0), hours: '1' },
      { ...shared, work_date: dayOf(week, 7), hours: '1' },
    ]);
    expect(twoWeeks.status()).toBe(422);
    expect(Object.keys((await twoWeeks.json()).error.field_errors)).toEqual([
      'entries.1.work_date',
    ]);
    const twice = await post([
      { ...shared, work_date: dayOf(week, 0), hours: '1' },
      { ...shared, work_date: dayOf(week, 0), hours: '2' },
    ]);
    expect(twice.status()).toBe(422);

    // A client cannot name the owner.
    const owner = await page.request.post(`${API}/time-entries/batch`, {
      headers: CSRF,
      data: {
        employee_id: '00000000-0000-4000-8000-000000000001',
        entries: [{ ...shared, work_date: dayOf(week, 0), hours: '1' }],
      },
    });
    expect(owner.status()).toBe(422);
    expect((await getWeek(page.request, week)).entries).toHaveLength(0);

    // A valid batch returns the entries and the recomputed week summary.
    const ok = await post([
      { ...shared, work_date: dayOf(week, 0), hours: '0.10' },
      { ...shared, work_date: dayOf(week, 1), hours: '0.20' },
    ]);
    expect(ok.status()).toBe(201);
    const body = await ok.json();
    expect(body.entries).toHaveLength(2);
    expect(body.summary.total_hours).toBe('0.30');
    expect(body.daily_totals).toHaveLength(7);
  });

  test('refuses a batch into a submitted week and requires a session', async ({
    employeePage: page,
    playwright,
    baseURL,
  }) => {
    const r = await refs(page.request);
    const entries = [
      {
        work_date: '2026-10-06',
        hours: '1',
        earning_code_id: r.earning('REG'),
        project_id: r.project('PRJ-003'),
        description: 'refused',
      },
    ];
    const locked = await page.request.post(`${API}/time-entries/batch`, {
      headers: CSRF,
      data: { entries },
    });
    expect(locked.status()).toBe(409);
    expect((await locked.json()).error.code).toBe('WEEK_NOT_EDITABLE');
    expect((await getWeek(page.request, '2026-10-05')).summary.total_hours).toBe('32.00');

    const anonymous = await playwright.request.newContext({ baseURL });
    const denied = await anonymous.post(`${API}/time-entries/batch`, {
      headers: CSRF,
      data: { entries },
    });
    expect(denied.status()).toBe(401);
    await anonymous.dispose();
  });
});

test.describe('Week mode accessibility and layout', () => {
  test('the grid, its error state and the mode toggle have no axe violations', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-a11y', testInfo.project.name);
    await openWeek(page, week);
    const p = await openWeekMode(page);
    await expectNoAxeViolations(page);
    await dayInput(p, week).fill('25');
    await p.getByRole('button', { name: 'Save entries' }).click();
    await expect(p.getByRole('alert')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('the mode radios work with arrow keys', async ({
    employeePage: page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      'WebKit on macOS does not Tab onto form controls by default',
    );
    const week = await isolatedWeek(page.request, 'week-keyboard', testInfo.project.name);
    await openWeek(page, week);
    await page.getByRole('button', { name: 'Add entry' }).click();
    const p = panel(page);
    const dayRadio = p.getByRole('radio', { name: /^Day/ });
    await dayRadio.focus();
    await page.keyboard.press('ArrowRight');
    await expect(p.getByRole('radio', { name: /^Week/ })).toBeChecked();
    await expect(p.getByRole('button', { name: 'Save entries' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(dayRadio).toBeChecked();
  });

  test('fits a 375px screen: no sideways scrolling, total and Save stay reachable', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'week-mobile', testInfo.project.name);
    await page.setViewportSize({ width: 375, height: 667 });
    await openWeek(page, week);
    const p = await openWeekMode(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await p.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    // No row of the grid may be wider than the panel (no clipped inputs).
    for (const input of await p.getByLabel(/^Hours for/).all()) {
      const rect = await input.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(375);
    }
    await expect(p.getByRole('button', { name: 'Save entries' })).toBeInViewport();

    await fillShared(p);
    await dayInput(p, week).fill('6');
    await p.getByTestId('week-total').scrollIntoViewIfNeeded();
    await expect(p.getByTestId('week-total')).toHaveText('6.00');
    await p.getByRole('button', { name: 'Save entries' }).click();
    await expect(page.getByTestId('total-hours')).toHaveText('6.00');
    await expectNoAxeViolations(page);
  });
});
