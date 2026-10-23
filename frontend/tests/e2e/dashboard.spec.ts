import {
  API,
  EMPLOYEE2,
  expect,
  expectNoAxeViolations,
  openWeek,
  signInViaApi,
  test,
} from './fixtures';

// Seed data (backend/app/seeding.py), employee@example.test, Monday-first weeks:
//   2026-10-19 DRAFT      Mon 8.00 | Tue 6.00+2.00 | Wed 7.50 | Thu 8.00 | Fri 2.50 (OVT)  => 34.00
//   2026-10-12 DRAFT      Mon-Fri 8.00                                                      => 40.00
//   2026-10-05 SUBMITTED  Mon-Thu 8.00                                                      => 32.00
//   2026-09-28 REJECTED   Mon-Wed 8.00, "Please correct the hours recorded for Wednesday."

test.describe('employee dashboard', () => {
  test('shows the selected week with seven daily cards and their hours', async ({
    employeePage: page,
  }) => {
    await openWeek(page, '2026-10-19');
    await expect(page.getByRole('heading', { name: 'Oct 19 – Oct 25, 2026' })).toBeVisible();

    const cards = page.getByTestId('day-card');
    await expect(cards).toHaveCount(7);
    const expected = [
      ['Mon', 'Oct 19', '8.00'],
      ['Tue', 'Oct 20', '8.00'],
      ['Wed', 'Oct 21', '7.50'],
      ['Thu', 'Oct 22', '8.00'],
      ['Fri', 'Oct 23', '2.50'],
      ['Sat', 'Oct 24', '0.00'],
      ['Sun', 'Oct 25', '0.00'],
    ];
    for (const [index, [day, date, hours]] of expected.entries()) {
      await expect(cards.nth(index)).toContainText(day!);
      await expect(cards.nth(index)).toContainText(date!);
      await expect(cards.nth(index)).toContainText(hours!);
    }
  });

  test('weekly summary equals the persisted data returned by the API', async ({
    employeePage: page,
  }) => {
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');

    const api = await (await page.request.get(`${API}/timesheets/weeks/2026-10-19`)).json();
    await expect(page.getByTestId('total-hours')).toHaveText(api.summary.total_hours);
    await expect(page.getByTestId('capped-hours')).toHaveText(api.summary.capped_hours);
    await expect(page.getByTestId('non-capped-hours')).toHaveText(api.summary.non_capped_hours);
    await expect(page.getByTestId('entry-count')).toHaveText(String(api.summary.entry_count));
    await expect(page.getByTestId('draft-count')).toHaveText(String(api.summary.draft_count));
    // Known seed values, so a bug that changes both API and UI together is still caught.
    await expect(page.getByTestId('capped-hours')).toHaveText('31.50');
    await expect(page.getByTestId('non-capped-hours')).toHaveText('2.50');
    await expect(page.getByTestId('entry-count')).toHaveText('6');
    await expect(page.getByText('Status:')).toContainText('Draft');
  });

  test('lists entries grouped by date with project, task, code and hours', async ({
    employeePage: page,
  }) => {
    await openWeek(page, '2026-10-19');
    const groups = page.getByTestId('entry-group');
    await expect(groups).toHaveCount(5);
    await expect(groups.nth(0)).toContainText('Monday, October 19');
    await expect(groups.nth(1)).toContainText('Tuesday, October 20');
    await expect(groups.nth(1).getByTestId('entry-card')).toHaveCount(2);

    const first = groups.nth(0).getByTestId('entry-card');
    await expect(first).toContainText('PRJ-001');
    await expect(first).toContainText('Platform Development');
    await expect(first).toContainText('Development');
    await expect(first).toContainText('Sprint planning and implementation');
    await expect(first).toContainText('Regular Work (REG) · Capped');
    await expect(first).toContainText('8.00');

    const friday = groups.nth(4);
    await expect(friday).toContainText('Overtime (OVT) · Non-capped');
  });

  test('navigates between weeks and updates the URL and totals', async ({ employeePage: page }) => {
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');

    await page.getByRole('button', { name: /previous week/i }).click();
    await expect(page).toHaveURL(/week=2026-10-12$/);
    await expect(page.getByRole('heading', { name: 'Oct 12 – Oct 18, 2026' })).toBeVisible();
    await expect(page.getByTestId('total-hours')).toHaveText('40.00');
    await expect(page.getByTestId('entry-count')).toHaveText('5');

    await page.getByRole('button', { name: /next week/i }).click();
    await page.getByRole('button', { name: /next week/i }).click();
    await expect(page).toHaveURL(/week=2026-10-26$/);
    await expect(page.getByRole('heading', { name: 'Oct 26 – Nov 1, 2026' })).toBeVisible();
    await expect(page.getByText('No time entries this week')).toBeVisible();
    await expect(page.getByTestId('total-hours')).toHaveText('0.00');
  });

  test('"Current week" returns to the server-defined current week', async ({
    employeePage: page,
  }) => {
    const meta = await (await page.request.get(`${API}/meta`)).json();
    await openWeek(page, '2026-10-12');
    await page.getByRole('button', { name: /current week/i }).click();
    await expect(page).not.toHaveURL(/week=/);
    const range = page.getByTestId('week-range');
    await expect(range).not.toHaveText(/loading/i);
    const weekApi = await (
      await page.request.get(`${API}/timesheets/weeks/${meta.current_week_start_date}`)
    ).json();
    expect(weekApi.week_start_date).toBe(meta.current_week_start_date);
    await expect(page.getByRole('button', { name: /current week/i })).toBeDisabled();
    await expect(page.getByText('Today', { exact: true })).toBeVisible();
  });

  test('normalises a mid-week date in the URL to the week start', async ({
    employeePage: page,
  }) => {
    await openWeek(page, '2026-10-22');
    await expect(page).toHaveURL(/week=2026-10-19$/);
    await expect(page.getByRole('heading', { name: 'Oct 19 – Oct 25, 2026' })).toBeVisible();
  });

  test('handles a week that spans New Year', async ({ employeePage: page }) => {
    await openWeek(page, '2025-12-29');
    await expect(page.getByRole('heading', { name: 'Dec 29, 2025 – Jan 4, 2026' })).toBeVisible();
    await expect(page.getByTestId('day-card')).toHaveCount(7);
    await expect(page.getByTestId('day-card').nth(3)).toContainText('Jan 1');
  });

  test('shows submitted weeks as read-only', async ({ employeePage: page }) => {
    await openWeek(page, '2026-10-05');
    await expect(page.getByText('Status:')).toContainText('Submitted');
    await expect(page.getByText(/submitted and read-only/)).toBeVisible();
    await expect(page.getByTestId('total-hours')).toHaveText('32.00');
    await expect(page.getByTestId('draft-count')).toHaveText('0');
    await expect(page.getByRole('button', { name: /delete|edit/i })).toHaveCount(0);
  });

  test('shows the rejection reason on a rejected week', async ({ employeePage: page }) => {
    await openWeek(page, '2026-09-28');
    await expect(page.getByText('Status:')).toContainText('Rejected');
    await expect(page.getByText(/This week was rejected/)).toBeVisible();
    await expect(page.getByText('Please correct the hours recorded for Wednesday.')).toBeVisible();
  });
});

test.describe('data isolation', () => {
  test("an employee never sees another employee's entries", async ({ page }) => {
    await signInViaApi(page.request, EMPLOYEE2);
    await openWeek(page, '2026-10-19');
    await expect(page.getByText('Sam Employee')).toBeVisible();
    await expect(page.getByTestId('total-hours')).toHaveText('4.00');
    await expect(page.getByTestId('entry-card')).toHaveCount(1);
    await expect(page.getByText('Operations handover')).toBeVisible();
    await expect(page.getByText('Sprint planning and implementation')).toHaveCount(0);

    // A week only the other employee has data for is empty for this one.
    await openWeek(page, '2026-10-12');
    await expect(page.getByText('No time entries this week')).toBeVisible();
  });

  test('the API refuses unauthenticated access to private data', async ({ request }) => {
    for (const path of ['/timesheets/weeks/2026-10-19', '/meta', '/projects', '/earning-codes']) {
      const response = await request.get(`${API}${path}`);
      expect(response.status(), path).toBe(401);
    }
  });
});

test.describe('failure handling', () => {
  test('recovers silently from a single transient server error', async ({ employeePage: page }) => {
    let failures = 0;
    await page.route('**/api/v1/timesheets/weeks/2026-10-19', async (route) => {
      if (failures++ === 0) await route.fulfill({ status: 503, body: 'upstream unavailable' });
      else await route.continue();
    });
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00', { timeout: 10_000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(failures).toBeGreaterThanOrEqual(2);
  });

  test('shows a useful error with a working retry when the API keeps failing', async ({
    employeePage: page,
  }) => {
    let broken = true;
    await page.route('**/api/v1/timesheets/weeks/2026-10-19', async (route) => {
      // Keep failing (including the client's automatic retries) until the test repairs the API.
      if (broken) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'An unexpected error occurred.',
              field_errors: {},
              request_id: 'e2e-request-id',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });
    await openWeek(page, '2026-10-19');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('An unexpected error occurred.', { timeout: 15_000 });
    await expect(alert).toContainText('Reference: e2e-request-id');
    broken = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('explains a network failure and recovers when the connection returns', async ({
    employeePage: page,
  }) => {
    let offline = true;
    await page.route('**/api/v1/timesheets/weeks/2026-10-19', async (route) => {
      if (offline) await route.abort('connectionfailed');
      else await route.continue();
    });
    await openWeek(page, '2026-10-19');
    await expect(page.getByRole('alert')).toContainText('Unable to reach the server', {
      timeout: 15_000,
    });
    offline = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');
  });

  test('returns to sign-in when the session expires', async ({ employeePage: page }) => {
    await page.route('**/api/v1/timesheets/weeks/2026-10-12', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication is required.',
            field_errors: {},
            request_id: 'x',
          },
        }),
      }),
    );
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');
    await page.getByRole('button', { name: /previous week/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/session has ended/i)).toBeVisible();
  });
});

test.describe('accessibility and responsiveness', () => {
  test('dashboard has no automatically detectable WCAG A/AA violations', async ({
    employeePage: page,
  }) => {
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('empty, submitted and rejected states also pass the automated checks', async ({
    employeePage: page,
  }) => {
    for (const week of ['2026-10-26', '2026-10-05', '2026-09-28']) {
      await openWeek(page, week);
      await expect(page.getByTestId('total-hours')).toBeVisible();
      await expectNoAxeViolations(page);
    }
  });

  test('week navigation works with the keyboard alone', async ({
    employeePage: page,
    browserName,
  }) => {
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');
    const previous = page.getByRole('button', { name: /previous week/i });
    const next = page.getByRole('button', { name: /next week/i });

    await previous.focus();
    await expect(previous).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Oct 12 – Oct 18, 2026' })).toBeVisible();

    // Safari-family browsers on macOS do not Tab onto buttons unless an OS preference is set,
    // so Tab order is only asserted where the engine follows the standard behaviour.
    // Activation by keyboard is checked on every engine.
    if (browserName === 'webkit') await next.focus();
    else await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('heading', { name: 'Oct 19 – Oct 25, 2026' })).toBeVisible();
  });

  test('the live region announces the loaded week', async ({ employeePage: page }) => {
    await openWeek(page, '2026-10-19');
    await expect(page.getByRole('status').filter({ hasText: 'Showing Oct 19' })).toContainText(
      'Total 34.00 hours in 6 entries',
    );
  });

  test('stays usable at a narrow mobile width without horizontal scrolling', async ({
    employeePage: page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(0);

    for (const name of [/previous week/i, /next week/i, /current week/i]) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    for (const card of await page.getByTestId('day-card').all()) {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    await expectNoAxeViolations(page);
  });
});

test.describe('visual capture', () => {
  test('saves screenshots when E2E_SCREENSHOT_DIR is set', async ({
    employeePage: page,
  }, testInfo) => {
    test.skip(!process.env.E2E_SCREENSHOT_DIR, 'set E2E_SCREENSHOT_DIR to capture screenshots');
    const dir = process.env.E2E_SCREENSHOT_DIR!;
    const name = testInfo.project.name;
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');
    await page.screenshot({ path: `${dir}/${name}-desktop.png`, fullPage: true });
    await openWeek(page, '2026-09-28');
    await expect(page.getByText(/This week was rejected/)).toBeVisible();
    await page.screenshot({ path: `${dir}/${name}-rejected.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await openWeek(page, '2026-10-19');
    await expect(page.getByTestId('total-hours')).toHaveText('34.00');
    await page.screenshot({ path: `${dir}/${name}-mobile.png`, fullPage: true });
  });
});
