import type { Locator, Page } from '@playwright/test';
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
  refs,
  signInViaApi,
  test,
} from './fixtures';

function panel(page: Page): Locator {
  return page.getByRole('dialog', { name: /time entry/i });
}

async function openAdd(page: Page) {
  await page.getByRole('button', { name: 'Add entry' }).click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

async function chooseProject(p: Locator, text: RegExp) {
  await p.getByRole('combobox', { name: /^Project/ }).click();
  await p.getByRole('option', { name: text }).click();
}

interface EntryFields {
  date: string;
  hours: string;
  earning?: string;
  project?: RegExp;
  task?: string;
  description?: string;
}

async function fillEntry(p: Locator, f: EntryFields) {
  await p.getByLabel(/^Date/).fill(f.date);
  await p.getByLabel(/^Hours/).fill(f.hours);
  await p
    .getByLabel(/^Earning code/)
    .selectOption({ label: f.earning ?? 'REG — Regular Work (capped)' });
  await chooseProject(p, f.project ?? /PRJ-001/);
  if (f.task) await p.getByLabel(/^Task/).selectOption({ label: f.task });
  await p.getByLabel(/^Work description/).fill(f.description ?? 'Automated entry');
}

test.describe('Add time entry (Day mode)', () => {
  test('opens as a labelled dialog with every required field and focus inside', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'open-panel', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);

    await expect(p).toHaveAttribute('aria-modal', 'true');
    for (const label of [/^Date/, /^Hours/, /^Earning code/, /^Task/, /^Work description/]) {
      await expect(p.getByLabel(label)).toBeVisible();
    }
    await expect(p.getByRole('combobox', { name: /^Project/ })).toBeVisible();
    await expect(p.getByLabel(/^Date/)).toHaveValue(week); // defaults inside the selected week
    await expect(p.getByLabel(/^Date/)).toHaveAttribute('min', week);
    await expect(p.getByLabel(/^Task/)).toBeDisabled();
    expect(await p.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await expect(p.getByRole('button', { name: 'Save entry' })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('shows required-field validation without calling the API', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'validation', testInfo.project.name);
    const posts: string[] = [];
    page.on(
      'request',
      (r) => r.method() === 'POST' && r.url().includes('/time-entries') && posts.push(r.url()),
    );
    await openWeek(page, week);
    const p = await openAdd(page);
    await p.getByRole('button', { name: 'Save entry' }).click();

    const summary = p.getByRole('alert');
    await expect(summary).toContainText('Please fix 4 fields before saving');
    await expect(summary).toBeFocused();
    for (const message of [
      'Hours are required.',
      'Select an earning code.',
      'Select a project.',
      'Description is required.',
    ]) {
      await expect(p.getByText(message).first()).toBeVisible();
    }
    await expect(p.getByLabel(/^Hours/)).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toHaveLength(0);

    // Each summary entry links to its field.
    await summary.getByRole('link', { name: /Hours:/ }).click();
    await expect(p.getByLabel(/^Hours/)).toBeFocused();
  });

  test('client-side limits: hours above the maximum and more than two decimals', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'hours-limit', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    await p.getByLabel(/^Hours/).fill('24.5');
    await p.getByRole('button', { name: 'Save entry' }).click();
    await expect(p.getByText('Hours cannot exceed 24 per entry.').first()).toBeVisible();
    await p.getByLabel(/^Hours/).fill('7.555');
    await p.getByRole('button', { name: 'Save entry' }).click();
    await expect(p.getByText('Hours can have at most two decimal places.').first()).toBeVisible();
    await p.getByLabel(/^Hours/).fill('0');
    await p.getByRole('button', { name: 'Save entry' }).click();
    await expect(p.getByText('Hours must be greater than zero.').first()).toBeVisible();
  });

  test('a task can only be chosen after a project, and only from that project', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'project-task', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    const task = p.getByLabel(/^Task/);
    await expect(task).toBeDisabled();

    await chooseProject(p, /PRJ-001/);
    await expect(task).toBeEnabled();
    // Listed in task-code order: DEV, REV, TST.
    await expect(task.getByRole('option')).toHaveText([
      'Select a task',
      'Development',
      'Code Review',
      'Testing',
    ]);
    await task.selectOption({ label: 'Testing' });

    // Switching projects resets the task to that project's list.
    await chooseProject(p, /PRJ-002/);
    await expect(task).toHaveValue('');
    await expect(task.getByRole('option')).toHaveText([
      'Select a task',
      'Design',
      'Implementation',
    ]);

    // A project without tasks does not require one.
    await chooseProject(p, /PRJ-003/);
    await expect(task).toBeDisabled();
    await expect(p.getByText('No tasks for this project')).toBeAttached();
    await expect(p.getByText('(optional)')).toBeVisible(); // nothing to choose, so not required
  });

  test('the project search filters by code or name', async ({ employeePage: page }, testInfo) => {
    const week = await isolatedWeek(page.request, 'project-task', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    const combobox = p.getByRole('combobox', { name: /^Project/ });
    const options = p.getByRole('listbox', { name: 'Projects' }).getByRole('option');
    await combobox.fill('portal');
    await expect(options).toHaveText(['PRJ-002 — Customer Portal']);
    await combobox.fill('prj-00');
    await expect(options).toHaveCount(3);
    await combobox.fill('zzz');
    await expect(p.getByText('No matching projects')).toBeVisible();
    await expect(options).toHaveCount(0);
  });

  test('saves an entry: it appears in the list, daily card and summary, and is persisted', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'create', testInfo.project.name);
    const wednesday = dayOf(week, 2);
    await openWeek(page, week);
    await expect(page.getByText('No time entries this week')).toBeVisible();

    const p = await openAdd(page);
    await fillEntry(p, {
      date: wednesday,
      hours: '7.5',
      task: 'Development',
      description: 'Built the thing',
    });
    await p.getByRole('button', { name: 'Save entry' }).click();

    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Entry saved.' })).toBeVisible();

    const card = page.getByTestId('entry-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('PRJ-001');
    await expect(card).toContainText('Development');
    await expect(card).toContainText('Built the thing');
    await expect(card).toContainText('Regular Work (REG) · Capped');
    await expect(card).toContainText('7.50');
    await expect(page.getByTestId('day-card').nth(2)).toContainText('7.50');
    await expect(page.getByTestId('total-hours')).toHaveText('7.50');
    await expect(page.getByTestId('capped-hours')).toHaveText('7.50');
    await expect(page.getByTestId('non-capped-hours')).toHaveText('0.00');
    await expect(page.getByTestId('entry-count')).toHaveText('1');
    await expect(page.getByTestId('draft-count')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Add entry' })).toBeFocused();
  });

  test('a saved entry survives a reload and is stored in the database via the API', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'persist', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    await fillEntry(p, {
      date: dayOf(week, 1),
      hours: '3.25',
      earning: 'OVT — Overtime (non-capped)',
      project: /PRJ-003/,
      description: 'Persistence check',
    });
    await p.getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByTestId('total-hours')).toHaveText('3.25');

    await page.reload();
    await expect(page.getByTestId('entry-card')).toContainText('Persistence check');
    await expect(page.getByTestId('non-capped-hours')).toHaveText('3.25');

    const data = await getWeek(page.request, week);
    expect(data.status).toBe('DRAFT');
    expect(data.id).not.toBeNull();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({
      work_date: dayOf(week, 1),
      hours: '3.25',
      description: 'Persistence check',
      task: null,
      project: { code: 'PRJ-003' },
      earning_code: { code: 'OVT', classification: 'NON_CAPPED' },
    });
  });

  test('descriptions are rendered as text, not HTML', async ({ employeePage: page }, testInfo) => {
    const week = await isolatedWeek(page.request, 'description-text', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    await fillEntry(p, {
      date: week,
      hours: '1',
      project: /PRJ-003/,
      description: '<img src=x onerror="window.__pwned=1"> <b>bold</b>',
    });
    await p.getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByTestId('entry-card')).toContainText('<b>bold</b>');
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    await expect(page.getByTestId('entry-card').locator('b, img')).toHaveCount(0);
  });

  test('double-clicking Save creates exactly one entry', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'double-click', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    await fillEntry(p, { date: week, hours: '2', project: /PRJ-003/ });
    await p.getByRole('button', { name: 'Save entry' }).dblclick();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId('entry-card')).toHaveCount(1);
    expect((await getWeek(page.request, week)).entries).toHaveLength(1);
  });
});

test.describe('Edit and cancel', () => {
  test('edits a draft entry and the totals update', async ({ employeePage: page }, testInfo) => {
    const week = await isolatedWeek(page.request, 'edit', testInfo.project.name);
    await createEntryViaApi(page.request, {
      work_date: week,
      hours: '8.00',
      description: 'Original text',
    });
    await openWeek(page, week);
    await expect(page.getByTestId('total-hours')).toHaveText('8.00');

    await page.getByRole('button', { name: /^Edit entry: PRJ-001/ }).click();
    const p = panel(page);
    await expect(p).toHaveAccessibleName('Edit time entry');
    await expect(p.getByLabel(/^Hours/)).toHaveValue('8.00');
    await expect(p.getByLabel(/^Work description/)).toHaveValue('Original text');
    await expect(p.getByRole('combobox', { name: /^Project/ })).toHaveValue(
      'PRJ-001 — Platform Development',
    );
    await expect(p.getByLabel(/^Task/)).toHaveValue(/.+/);

    await p.getByLabel(/^Hours/).fill('5.5');
    await p.getByLabel(/^Earning code/).selectOption({ label: 'OVT — Overtime (non-capped)' });
    await p.getByLabel(/^Work description/).fill('Edited text');
    await p.getByRole('button', { name: 'Save entry' }).click();

    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Entry updated.' })).toBeVisible();
    await expect(page.getByTestId('total-hours')).toHaveText('5.50');
    await expect(page.getByTestId('capped-hours')).toHaveText('0.00');
    await expect(page.getByTestId('non-capped-hours')).toHaveText('5.50');
    await expect(page.getByTestId('entry-card')).toContainText('Edited text');
    await expect(page.getByTestId('entry-card')).not.toContainText('Original text');
    const data = await getWeek(page.request, week);
    expect(data.entries[0]).toMatchObject({ hours: '5.50', version: 2 });
  });

  test('cancelling an edited form warns before discarding; keep editing preserves the changes', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'cancel-warning', testInfo.project.name);
    await createEntryViaApi(page.request, { work_date: week, hours: '8.00' });
    await openWeek(page, week);
    await page.getByRole('button', { name: /^Edit entry/ }).click();
    const p = panel(page);
    await p.getByLabel(/^Hours/).fill('1');

    await p.getByRole('button', { name: 'Cancel' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Discard changes?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(p.getByLabel(/^Hours/)).toHaveValue('1');

    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Discard changes' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId('total-hours')).toHaveText('8.00'); // nothing was saved
    await expect(page.getByRole('button', { name: /^Edit entry/ })).toBeFocused();
  });

  test('cancelling an untouched form closes without a prompt', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'open-panel', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    await p.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('reports a conflict when the entry was changed elsewhere, keeping the form', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'stale-edit', testInfo.project.name);
    const entry = await createEntryViaApi(page.request, { work_date: week, hours: '8.00' });
    await openWeek(page, week);
    await page.getByRole('button', { name: /^Edit entry/ }).click();
    const p = panel(page);

    // Someone else (another tab/session) changes the entry first.
    const other = await page.request.patch(`${API}/time-entries/${entry.id}`, {
      headers: CSRF,
      data: { hours: '2.00' },
    });
    expect(other.ok()).toBe(true);

    await p.getByLabel(/^Work description/).fill('My late edit');
    await p.getByRole('button', { name: 'Save entry' }).click();
    await expect(p.getByText(/changed elsewhere/)).toBeVisible();
    await expect(p.getByLabel(/^Work description/)).toHaveValue('My late edit');
    expect((await getWeek(page.request, week)).entries[0].description).toBe('Seeded by test');
  });
});

test.describe('Delete', () => {
  test('deletes an entry only after confirmation and updates totals', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'delete', testInfo.project.name);
    await createEntryViaApi(page.request, {
      work_date: week,
      hours: '4.00',
      description: 'Keep me',
    });
    await createEntryViaApi(page.request, {
      work_date: dayOf(week, 1),
      hours: '3.00',
      project: 'PRJ-003',
      task: null,
      description: 'Delete me',
    });
    await openWeek(page, week);
    await expect(page.getByTestId('total-hours')).toHaveText('7.00');

    await page.getByRole('button', { name: /^Delete entry: PRJ-003/ }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete this entry?' });
    await expect(dialog).toContainText('3.00 h');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Cancelling leaves the data alone.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('entry-card')).toHaveCount(2);

    await page.getByRole('button', { name: /^Delete entry: PRJ-003/ }).click();
    await dialog.getByRole('button', { name: 'Delete entry' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Entry deleted.' })).toBeVisible();
    await expect(page.getByTestId('entry-card')).toHaveCount(1);
    await expect(page.getByTestId('entry-card')).toContainText('Keep me');
    await expect(page.getByTestId('total-hours')).toHaveText('4.00');
    expect((await getWeek(page.request, week)).entries).toHaveLength(1);
  });
});

test.describe('Totals', () => {
  test('daily, weekly and classification totals match the persisted API data after changes', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'totals-match', testInfo.project.name);
    await createEntryViaApi(page.request, { work_date: week, hours: '8.00' });
    await createEntryViaApi(page.request, { work_date: week, hours: '0.10', earning: 'OVT' });
    await createEntryViaApi(page.request, { work_date: week, hours: '0.20', earning: 'OVT' });
    await createEntryViaApi(page.request, {
      work_date: dayOf(week, 4),
      hours: '6.75',
      earning: 'TRN',
    });
    await openWeek(page, week);

    const api = await getWeek(page.request, week);
    await expect(page.getByTestId('total-hours')).toHaveText(api.summary.total_hours);
    await expect(page.getByTestId('capped-hours')).toHaveText(api.summary.capped_hours);
    await expect(page.getByTestId('non-capped-hours')).toHaveText(api.summary.non_capped_hours);
    await expect(page.getByTestId('entry-count')).toHaveText('4');
    // 0.10 + 0.20 must be exactly 0.30 (no floating-point drift anywhere in the stack).
    await expect(page.getByTestId('non-capped-hours')).toHaveText('0.30');
    await expect(page.getByTestId('total-hours')).toHaveText('15.05');
    for (const [index, day] of api.daily_totals.entries()) {
      await expect(page.getByTestId('day-card').nth(index)).toContainText(day.hours);
    }
  });
});

test.describe('Authorization and locked weeks', () => {
  test("another employee cannot edit or delete someone else's entry", async ({
    employeePage: page,
    playwright,
    baseURL,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'ownership', testInfo.project.name);
    const entry = await createEntryViaApi(page.request, { work_date: week, hours: '8.00' });

    const intruder = await playwright.request.newContext({ baseURL });
    await signInViaApi(intruder, EMPLOYEE2);
    const patch = await intruder.patch(`${API}/time-entries/${entry.id}`, {
      headers: CSRF,
      data: { hours: '1.00' },
    });
    const del = await intruder.delete(`${API}/time-entries/${entry.id}`, { headers: CSRF });
    const missing = await intruder.delete(
      `${API}/time-entries/00000000-0000-4000-8000-000000000000`,
      {
        headers: CSRF,
      },
    );
    expect([patch.status(), del.status(), missing.status()]).toEqual([404, 404, 404]);
    expect((await getWeek(intruder, week)).entries).toHaveLength(0); // they see nothing of mine
    await intruder.dispose();

    const mine = await getWeek(page.request, week);
    expect(mine.entries).toHaveLength(1);
    expect(mine.entries[0].hours).toBe('8.00');
  });

  test('a submitted week offers no controls and the API refuses changes', async ({
    employeePage: page,
  }) => {
    await openWeek(page, '2026-10-05'); // seeded SUBMITTED week
    await expect(page.getByText(/submitted and read-only/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add entry' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit entry/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete entry/ })).toHaveCount(0);

    const data = await getWeek(page.request, '2026-10-05');
    const r = await refs(page.request);
    const create = await page.request.post(`${API}/time-entries`, {
      headers: CSRF,
      data: {
        work_date: '2026-10-06',
        hours: '1',
        earning_code_id: r.earning('REG'),
        project_id: r.project('PRJ-003'),
        description: 'should be refused',
      },
    });
    const patch = await page.request.patch(`${API}/time-entries/${data.entries[0].id}`, {
      headers: CSRF,
      data: { hours: '1' },
    });
    const del = await page.request.delete(`${API}/time-entries/${data.entries[0].id}`, {
      headers: CSRF,
    });
    for (const response of [create, patch, del]) {
      expect(response.status()).toBe(409);
      expect((await response.json()).error.code).toBe('WEEK_NOT_EDITABLE');
    }
    expect((await getWeek(page.request, '2026-10-05')).summary.total_hours).toBe('32.00');
  });

  test('the API requires the CSRF header and a session for writes', async ({ request }) => {
    const anonymous = await request.post(`${API}/time-entries`, { headers: CSRF, data: {} });
    expect(anonymous.status()).toBe(401);
  });
});

test.describe('Accessibility and responsiveness', () => {
  test('the open panel, its error state and the confirm dialog have no axe violations', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'a11y-panel', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    await expectNoAxeViolations(page);

    await p.getByRole('button', { name: 'Save entry' }).click();
    await expect(p.getByRole('alert')).toBeVisible();
    await expectNoAxeViolations(page);

    await p.getByLabel(/^Hours/).fill('1');
    await p.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a keyboard-only user can add an entry and Escape returns focus to Add entry', async ({
    employeePage: page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      'WebKit on macOS does not Tab onto form controls by default',
    );
    const week = await isolatedWeek(page.request, 'keyboard', testInfo.project.name);
    await openWeek(page, week);
    const add = page.getByRole('button', { name: 'Add entry' });
    await add.focus();
    await page.keyboard.press('Enter');
    const p = panel(page);
    await expect(p).toBeVisible();

    // Focus starts inside the panel. The date keeps its default; walk the rest with keys only.
    // (Native date inputs have several internal tab stops that differ per browser, so start at Hours.)
    // Controls are disabled until the reference data has loaded; wait so Tab can reach them.
    await expect(p.getByLabel(/^Earning code/)).toBeEnabled();
    await expect(p.getByRole('combobox', { name: /^Project/ })).toBeEnabled();
    await p.getByLabel(/^Hours/).focus();
    await expect(p.getByLabel(/^Hours/)).toBeFocused();
    await page.keyboard.type('6');
    await page.keyboard.press('Tab');
    await expect(p.getByLabel(/^Earning code/)).toBeFocused();
    await page.keyboard.type('REG'); // native type-ahead selects "REG — Regular Work"
    await expect(p.getByLabel(/^Earning code/)).toHaveValue(/.+/);
    await page.keyboard.press('Tab');
    const combobox = p.getByRole('combobox', { name: /^Project/ });
    await expect(combobox).toBeFocused();
    await page.keyboard.type('operations');
    await expect(p.getByRole('listbox', { name: 'Projects' }).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('ArrowDown'); // already active; stays on the only match
    await page.keyboard.press('Enter');
    await expect(combobox).toHaveValue('PRJ-003 — Internal Operations');
    await expect(p).toBeVisible(); // Enter in the combobox must not submit the form
    await page.keyboard.press('Tab'); // the task field is disabled (no tasks), so it is skipped
    await expect(p.getByLabel(/^Work description/)).toBeFocused();
    await page.keyboard.type('Keyboard only');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // Cancel -> Save
    await expect(p.getByRole('button', { name: 'Save entry' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByTestId('total-hours')).toHaveText('6.00');
    await expect(add).toBeFocused();

    // Escape on a pristine form closes it and restores focus.
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('keeps Tab focus inside the open panel', async ({
    employeePage: page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName === 'webkit',
      'WebKit on macOS does not Tab onto form controls by default',
    );
    const week = await isolatedWeek(page.request, 'focus-trap', testInfo.project.name);
    await openWeek(page, week);
    const p = await openAdd(page);
    await p.getByRole('button', { name: 'Save entry' }).focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await p.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await p.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    // The page behind the modal is inert.
    expect(await page.evaluate(() => document.getElementById('root')?.hasAttribute('inert'))).toBe(
      true,
    );
  });

  test('the panel fits a 375px screen and Save stays reachable', async ({
    employeePage: page,
  }, testInfo) => {
    const week = await isolatedWeek(page.request, 'mobile', testInfo.project.name);
    await page.setViewportSize({ width: 375, height: 667 });
    await openWeek(page, week);
    const p = await openAdd(page);

    const box = await p.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The footer actions are always visible without scrolling the form.
    const save = p.getByRole('button', { name: 'Save entry' });
    await expect(save).toBeInViewport();
    await expect(p.getByRole('button', { name: 'Cancel' })).toBeInViewport();

    await fillEntry(p, { date: week, hours: '2', project: /PRJ-003/ });
    await save.click();
    await expect(page.getByTestId('total-hours')).toHaveText('2.00');
    await expectNoAxeViolations(page);
  });
});
