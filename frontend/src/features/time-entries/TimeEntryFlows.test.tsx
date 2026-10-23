import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimeEntry } from '../../api/types';
import {
  EARNING_CODES,
  META,
  PROJECTS,
  TASKS_P1,
  USER,
  entry,
  week,
  weekFromEntries,
} from '../../test/fixtures';
import { errorBody, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const START = '2026-10-19';

interface Server {
  entries: TimeEntry[];
  calls: string[];
  bodies: Record<string, unknown[]>;
}

/** A small stateful fake of the backend: entries live in memory and drive the week payload. */
function startServer(initial: TimeEntry[] = [], overrides: Parameters<typeof mockApi>[0] = {}) {
  const state: Server = { entries: [...initial], calls: [], bodies: {} };
  const api = mockApi({
    'GET /auth/me': () => ({ body: USER }),
    'GET /meta': () => ({ body: META }),
    'GET /projects': () => ({ body: { items: PROJECTS } }),
    'GET /projects/p1/tasks': () => ({ body: { items: TASKS_P1 } }),
    'GET /projects/p2/tasks': () => ({ body: { items: [] } }),
    'GET /earning-codes': () => ({ body: { items: EARNING_CODES } }),
    [`GET /timesheets/weeks/${START}`]: () => ({ body: weekFromEntries(START, state.entries) }),
    'POST /time-entries': (_url, init) => {
      const body = JSON.parse(String(init.body));
      (state.bodies.POST ??= []).push(body);
      const project = PROJECTS.find((p) => p.id === body.project_id) ?? PROJECTS[0]!;
      const code = EARNING_CODES.find((c) => c.id === body.earning_code_id) ?? EARNING_CODES[0];
      const created = entry({
        id: `new-${state.entries.length + 1}`,
        work_date: body.work_date,
        hours: body.hours.includes('.') ? body.hours : `${body.hours}.00`,
        description: body.description,
        project: { id: project.id, code: project.code, name: project.name },
        task: TASKS_P1.find((t) => t.id === body.task_id) ?? null,
        earning_code: { ...code },
      });
      state.entries.push(created);
      return { status: 201, body: created };
    },
    ...overrides,
  });
  return { ...api, state };
}

const existing = () => [
  entry({ id: 'e1', work_date: '2026-10-19', hours: '8.00', description: 'Sprint planning' }),
  entry({
    id: 'e2',
    work_date: '2026-10-20',
    hours: '2.50',
    description: 'Production support',
    task: null,
    project: { id: 'p2', code: 'PRJ-003', name: 'Internal Operations' },
    earning_code: { id: 'c2', code: 'OVT', name: 'Overtime', classification: 'NON_CAPPED' },
  }),
];

async function openAddPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add entry' }));
  return screen.findByRole('dialog', { name: 'Add time entry' });
}

async function fillValidEntry(
  user: ReturnType<typeof userEvent.setup>,
  panel: HTMLElement,
  { hours = '7.5', description = 'Wrote the feature' } = {},
) {
  const p = within(panel);
  await user.type(p.getByLabelText(/^Hours/), hours);
  await user.selectOptions(await p.findByLabelText(/^Earning code/), 'c1');
  await user.click(p.getByRole('combobox', { name: /^Project/ }));
  await user.click(await p.findByRole('option', { name: /PRJ-001/ }));
  await user.selectOptions(await p.findByLabelText(/^Task/), 't1');
  await user.type(p.getByLabelText(/^Work description/), description);
}

describe('Add time entry', () => {
  it('opens as a labelled modal dialog with focus inside, and defaults the date to today', async () => {
    const user = userEvent.setup();
    startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(panel.contains(document.activeElement)).toBe(true);
    // server "today" is Fri 2026-10-23, inside the week
    expect(within(panel).getByLabelText(/^Date/)).toHaveValue('2026-10-23');
    expect(within(panel).getByLabelText(/^Date/)).toHaveAttribute('min', START);
    expect(within(panel).getByLabelText(/^Date/)).toHaveAttribute('max', '2026-10-25');
  });

  it('saves a valid entry, closes, announces success and refreshes totals from the API', async () => {
    const user = userEvent.setup();
    const { state, calls } = startServer();
    renderApp(`/?week=${START}`);
    expect(await screen.findByText('No time entries this week')).toBeInTheDocument();

    const panel = await openAddPanel(user);
    await fillValidEntry(user, panel);
    await user.click(within(panel).getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.bodies.POST).toEqual([
      {
        work_date: '2026-10-23',
        hours: '7.5',
        earning_code_id: 'c1',
        project_id: 'p1',
        task_id: 't1',
        description: 'Wrote the feature',
      },
    ]);
    expect(await screen.findByText('Entry saved.')).toBeInTheDocument();
    expect(await screen.findByTestId('total-hours')).toHaveTextContent('7.50');
    expect(screen.getByTestId('entry-count')).toHaveTextContent('1');
    expect(calls.filter((c) => c === `GET /timesheets/weeks/${START}`).length).toBeGreaterThan(1);
    // focus goes back to the control that opened the panel
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add entry' })).toHaveFocus());
  });

  it('never sends an employee or owner field', async () => {
    const user = userEvent.setup();
    const { state } = startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await fillValidEntry(user, panel);
    await user.click(within(panel).getByRole('button', { name: 'Save entry' }));
    await waitFor(() => expect(state.bodies.POST).toHaveLength(1));
    expect(Object.keys(state.bodies.POST![0] as object).sort()).toEqual(
      ['description', 'earning_code_id', 'hours', 'project_id', 'task_id', 'work_date'].sort(),
    );
  });

  it('shows required-field errors, links them to the inputs and does not call the API', async () => {
    const user = userEvent.setup();
    const { state } = startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await user.click(within(panel).getByRole('button', { name: 'Save entry' }));

    const summary = await within(panel).findByRole('alert');
    expect(summary).toHaveTextContent('Please fix 4 fields before saving');
    await waitFor(() => expect(summary).toHaveFocus());
    const hours = within(panel).getByLabelText(/^Hours/);
    expect(hours).toHaveAttribute('aria-invalid', 'true');
    const describedBy = hours.getAttribute('aria-describedby') ?? '';
    expect(
      describedBy
        .split(' ')
        .some((id) => document.getElementById(id)?.textContent?.includes('Hours are required')),
    ).toBe(true);
    expect(state.bodies.POST).toBeUndefined();

    // The summary link moves focus to the offending field.
    await user.click(within(summary).getByRole('link', { name: /Hours:/ }));
    expect(hours).toHaveFocus();

    // Fixing a field clears just that error.
    await user.type(hours, '4');
    expect(hours).not.toHaveAttribute('aria-invalid');
    expect(within(panel).getByLabelText(/^Work description/)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('keeps the task disabled until a project is chosen and clears it when the project changes', async () => {
    const user = userEvent.setup();
    startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    const p = within(panel);
    const task = p.getByLabelText(/^Task/);
    expect(task).toBeDisabled();

    await user.click(p.getByRole('combobox', { name: /^Project/ }));
    await user.click(await p.findByRole('option', { name: /PRJ-001/ }));
    await waitFor(() => expect(p.getByLabelText(/^Task/)).toBeEnabled());
    expect(p.getAllByRole('option', { name: /Development|Code Review/ })).toHaveLength(2);
    await user.selectOptions(p.getByLabelText(/^Task/), 't2');
    expect(p.getByLabelText(/^Task/)).toHaveValue('t2');

    // A project without tasks: the field becomes optional/disabled and the old task is gone.
    await user.click(p.getByRole('combobox', { name: /^Project/ }));
    await user.click(await p.findByRole('option', { name: /PRJ-003/ }));
    await waitFor(() => expect(p.getByLabelText(/^Task/)).toBeDisabled());
    expect(p.getByLabelText(/^Task/)).toHaveValue('');
    expect(p.getByText('No tasks for this project')).toBeInTheDocument();
  });

  it('never submits a task that belongs to a previously selected project', async () => {
    const user = userEvent.setup();
    const { state } = startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    const p = within(panel);
    await user.type(p.getByLabelText(/^Hours/), '3');
    await user.selectOptions(await p.findByLabelText(/^Earning code/), 'c1');
    await user.type(p.getByLabelText(/^Work description/), 'Switch project');

    await user.click(p.getByRole('combobox', { name: /^Project/ }));
    await user.click(await p.findByRole('option', { name: /PRJ-001/ }));
    await user.selectOptions(await p.findByLabelText(/^Task/), 't2');

    await user.click(p.getByRole('combobox', { name: /^Project/ }));
    await user.click(await p.findByRole('option', { name: /PRJ-003/ }));
    await waitFor(() => expect(p.getByLabelText(/^Task/)).toBeDisabled());
    await user.click(p.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(state.bodies.POST).toHaveLength(1));
    expect(state.bodies.POST![0]).toMatchObject({ project_id: 'p2', task_id: null });
  });

  it('keeps entered values and shows field errors returned by the server', async () => {
    const user = userEvent.setup();
    startServer([], {
      'POST /time-entries': () => ({
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The request contains invalid fields.',
            field_errors: { hours: 'Hours cannot exceed 12 per entry.', description: 'Nope.' },
            request_id: 'r1',
          },
        },
      }),
    });
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await fillValidEntry(user, panel, { hours: '9', description: 'Keep this text' });
    await user.click(within(panel).getByRole('button', { name: 'Save entry' }));

    expect(await within(panel).findByText('Hours cannot exceed 12 per entry.')).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^Hours/)).toHaveValue('9');
    expect(within(panel).getByLabelText(/^Work description/)).toHaveValue('Keep this text');
    expect(screen.getByRole('dialog', { name: 'Add time entry' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Save entry' })).toBeEnabled();
  });

  it('shows a form-level message when the week was locked meanwhile (409)', async () => {
    const user = userEvent.setup();
    startServer([], {
      'POST /time-entries': () =>
        errorBody('WEEK_NOT_EDITABLE', 'This week is submitted and cannot be changed.', 409),
    });
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await fillValidEntry(user, panel);
    await user.click(within(panel).getByRole('button', { name: 'Save entry' }));
    expect(await within(panel).findByText(/submitted and cannot be changed/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add time entry' })).toBeInTheDocument();
  });

  it('disables Save while a request is in flight so it cannot be double-submitted', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let posts = 0;
    const { state } = startServer([], {
      'POST /time-entries': async () => {
        posts += 1;
        await gate;
        return { status: 201, body: entry({ id: 'x' }) };
      },
    });
    void state;
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await fillValidEntry(user, panel);
    const save = within(panel).getByRole('button', { name: 'Save entry' });
    await user.click(save);
    const saving = await within(panel).findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(posts).toBe(1);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(posts).toBe(1);
  });
});

describe('closing the panel', () => {
  it('closes immediately, without a prompt, when nothing was changed', async () => {
    const user = userEvent.setup();
    startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add entry' })).toHaveFocus());
  });

  it('asks before discarding changes; "Keep editing" preserves them', async () => {
    const user = userEvent.setup();
    startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await user.type(within(panel).getByLabelText(/^Hours/), '5');
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(within(confirm).getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(panel).getByLabelText(/^Hours/)).toHaveValue('5');
  });

  it('discards the changes and closes when confirmed', async () => {
    const user = userEvent.setup();
    startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    await user.type(within(panel).getByLabelText(/^Hours/), '5');
    await user.click(within(panel).getByRole('button', { name: 'Close panel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // reopening starts from a clean form
    const again = await openAddPanel(user);
    expect(within(again).getByLabelText(/^Hours/)).toHaveValue('');
  });

  it('Escape follows the same rule: confirm when dirty, otherwise just close', async () => {
    const user = userEvent.setup();
    startServer();
    renderApp(`/?week=${START}`);
    let panel = await openAddPanel(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    panel = await openAddPanel(user);
    await user.type(within(panel).getByLabelText(/^Hours/), '5');
    await user.keyboard('{Escape}');
    const confirm = await screen.findByRole('alertdialog');
    // Escape on the confirmation closes only the confirmation, never the panel behind it.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(confirm).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add time entry' })).toBeInTheDocument();
  });

  it('traps Tab inside the panel', async () => {
    const user = userEvent.setup();
    startServer();
    renderApp(`/?week=${START}`);
    const panel = await openAddPanel(user);
    const save = within(panel).getByRole('button', { name: 'Save entry' });
    await waitFor(() => expect(save).toBeEnabled());
    save.focus();
    await user.tab();
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Close panel' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);
  });
});

describe('Edit time entry', () => {
  it('opens populated with the stored values and saves with the entry version', async () => {
    const user = userEvent.setup();
    const { state } = startServer(existing(), {
      'PATCH /time-entries/e1': (_url, init) => {
        const body = JSON.parse(String(init.body));
        (state.bodies.PATCH ??= []).push(body);
        const updated = { ...state.entries[0]!, hours: '6.25', version: 2 };
        state.entries[0] = updated;
        return { body: updated };
      },
    });
    renderApp(`/?week=${START}`);

    await user.click(
      await screen.findByRole('button', { name: 'Edit entry: PRJ-001 on Monday, October 19' }),
    );
    const panel = await screen.findByRole('dialog', { name: 'Edit time entry' });
    const p = within(panel);
    expect(p.getByLabelText(/^Date/)).toHaveValue('2026-10-19');
    expect(p.getByLabelText(/^Hours/)).toHaveValue('8.00');
    expect(p.getByLabelText(/^Work description/)).toHaveValue('Sprint planning');
    await waitFor(() =>
      expect(p.getByRole('combobox', { name: /^Project/ })).toHaveValue(
        'PRJ-001 — Platform Development',
      ),
    );
    await waitFor(() => expect(p.getByLabelText(/^Task/)).toHaveValue('t1'));

    const hours = p.getByLabelText(/^Hours/);
    await user.clear(hours);
    await user.type(hours, '6.25');
    await user.click(p.getByRole('button', { name: 'Save entry' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.bodies.PATCH).toEqual([
      expect.objectContaining({ hours: '6.25', version: 1, project_id: 'p1', task_id: 't1' }),
    ]);
    expect(await screen.findByText('Entry updated.')).toBeInTheDocument();
    expect(await screen.findByTestId('total-hours')).toHaveTextContent('8.75');
  });

  it('warns about unsaved edits when cancelling', async () => {
    const user = userEvent.setup();
    startServer(existing());
    renderApp(`/?week=${START}`);
    await user.click(await screen.findByRole('button', { name: /Edit entry: PRJ-001/ }));
    const panel = await screen.findByRole('dialog', { name: 'Edit time entry' });
    await user.type(within(panel).getByLabelText(/^Work description/), ' more');
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Discard changes?' }),
    ).toBeInTheDocument();
  });

  it('reports a stale-version conflict without losing the form', async () => {
    const user = userEvent.setup();
    startServer(existing(), {
      'PATCH /time-entries/e1': () =>
        errorBody('STALE_ENTRY', 'This entry was changed elsewhere. Reload it and try again.', 409),
    });
    renderApp(`/?week=${START}`);
    await user.click(await screen.findByRole('button', { name: /Edit entry: PRJ-001/ }));
    const panel = await screen.findByRole('dialog', { name: 'Edit time entry' });
    await user.type(within(panel).getByLabelText(/^Work description/), '!');
    await user.click(within(panel).getByRole('button', { name: 'Save entry' }));
    expect(await within(panel).findByText(/changed elsewhere/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^Work description/)).toHaveValue('Sprint planning!');
  });
});

describe('Delete time entry', () => {
  it('requires confirmation, then removes the entry and updates totals', async () => {
    const user = userEvent.setup();
    const { state, calls } = startServer(existing(), {
      'DELETE /time-entries/e2': () => {
        state.entries = state.entries.filter((e) => e.id !== 'e2');
        return { status: 204 };
      },
    });
    renderApp(`/?week=${START}`);
    expect(await screen.findByTestId('total-hours')).toHaveTextContent('10.50');

    await user.click(
      await screen.findByRole('button', { name: 'Delete entry: PRJ-003 on Tuesday, October 20' }),
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this entry?' });
    expect(dialog).toHaveTextContent('PRJ-003');
    expect(dialog).toHaveTextContent('2.50 h');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(calls).not.toContain('DELETE /time-entries/e2');

    await user.click(within(dialog).getByRole('button', { name: 'Delete entry' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(calls).toContain('DELETE /time-entries/e2');
    expect(await screen.findByText('Entry deleted.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('total-hours')).toHaveTextContent('8.00'));
    expect(screen.getAllByTestId('entry-card')).toHaveLength(1);
    // The delete button that opened the dialog is gone; focus lands on a stable control.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add entry' })).toHaveFocus());
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const { calls } = startServer(existing());
    renderApp(`/?week=${START}`);
    await user.click(await screen.findByRole('button', { name: /Delete entry: PRJ-001/ }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    expect(screen.getAllByTestId('entry-card')).toHaveLength(2);
  });

  it('keeps the dialog open and explains a failure', async () => {
    const user = userEvent.setup();
    startServer(existing(), {
      'DELETE /time-entries/e1': () =>
        errorBody('WEEK_NOT_EDITABLE', 'This week is submitted and cannot be changed.', 409),
    });
    renderApp(`/?week=${START}`);
    await user.click(await screen.findByRole('button', { name: /Delete entry: PRJ-001/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }));
    expect(await screen.findByText(/submitted and cannot be changed/)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('read-only weeks', () => {
  it('offers no add, edit or delete controls', async () => {
    mockApi({
      'GET /auth/me': () => ({ body: USER }),
      'GET /meta': () => ({ body: META }),
      [`GET /timesheets/weeks/${START}`]: () => ({
        body: {
          ...weekFromEntries(START, existing()),
          status: 'SUBMITTED',
          is_editable: false,
        },
      }),
    });
    renderApp(`/?week=${START}`);
    expect(await screen.findAllByTestId('entry-card')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Add entry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit entry/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete entry/ })).not.toBeInTheDocument();
  });

  it('still lets the user add to an empty editable week', async () => {
    startServer();
    renderApp(`/?week=${START}`);
    expect(await screen.findByRole('button', { name: 'Add entry' })).toBeInTheDocument();
    expect(week(START).is_editable).toBe(true);
  });
});
