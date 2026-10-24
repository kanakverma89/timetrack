import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimeEntry, TimesheetWeek } from '../../api/types';
import { META, USER, entry, populatedWeek, week, weekFromEntries } from '../../test/fixtures';
import { errorBody, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const START = '2026-10-19';
const KEY = /^[A-Za-z0-9_-]{8,100}$/;

const entries = (): TimeEntry[] => populatedWeek(START).entries;

interface Server {
  week: TimesheetWeek;
  submits: Array<{ body: unknown; key: string | undefined }>;
}

function startServer(
  initial: TimesheetWeek,
  submitHandler?: (server: Server) => { status?: number; body?: unknown },
) {
  const server: Server = { week: initial, submits: [] };
  const api = mockApi({
    'GET /auth/me': () => ({ body: USER }),
    'GET /meta': () => ({ body: META }),
    [`GET /timesheets/weeks/${START}`]: () => ({ body: server.week }),
    [`POST /timesheets/weeks/${START}/submit`]: (_url, init) => {
      const headers = init.headers as Record<string, string>;
      server.submits.push({ body: JSON.parse(String(init.body)), key: headers['Idempotency-Key'] });
      if (submitHandler) return submitHandler(server);
      server.week = {
        ...server.week,
        status: 'SUBMITTED',
        is_editable: false,
        submitted_at: '2026-10-24T10:11:00Z',
        summary: { ...server.week.summary, draft_count: 0 },
      };
      return { body: server.week };
    },
  });
  return { ...api, server };
}

const openDialog = async (user: ReturnType<typeof userEvent.setup>, name = 'Submit week') => {
  await user.click(await screen.findByRole('button', { name }));
  return screen.findByRole('alertdialog');
};

describe('Submit week button', () => {
  it('is offered on an editable week with entries', async () => {
    startServer(populatedWeek(START));
    renderApp(`/?week=${START}`);
    expect(await screen.findByRole('button', { name: 'Submit week' })).toBeEnabled();
  });

  it('is disabled, with a reason, when the week has no entries', async () => {
    startServer(week(START));
    renderApp(`/?week=${START}`);
    const button = await screen.findByRole('button', { name: 'Submit week' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Add at least one entry to submit.');
  });

  it('says "Resubmit" for a rejected week', async () => {
    startServer({ ...populatedWeek(START), status: 'REJECTED', review_comment: 'Fix Tuesday.' });
    renderApp(`/?week=${START}`);
    expect(await screen.findByRole('button', { name: 'Resubmit week' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Submit week' })).not.toBeInTheDocument();
  });

  it.each(['SUBMITTED', 'APPROVED'] as const)('is not offered on a %s week', async (status) => {
    startServer({ ...populatedWeek(START), status, is_editable: false });
    renderApp(`/?week=${START}`);
    await screen.findByTestId('total-hours');
    expect(
      screen.queryByRole('button', { name: /submit week|resubmit week/i }),
    ).not.toBeInTheDocument();
  });
});

describe('Submit week dialog', () => {
  it('summarises what is being submitted and puts the safe choice first', async () => {
    startServer(populatedWeek(START));
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    expect(dialog).toHaveAccessibleName('Submit this week?');
    expect(dialog).toHaveTextContent('Oct 19 – Oct 25, 2026');
    expect(dialog).toHaveTextContent('2 entries');
    expect(dialog).toHaveTextContent('10.50 hours (8.00 capped, 2.50 non-capped)');
    expect(dialog).toHaveTextContent('can no longer be added, changed or deleted');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('sends nothing when cancelled', async () => {
    const { server } = startServer(populatedWeek(START));
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(server.submits).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit week' })).toHaveFocus());
  });

  it('submits once with an idempotency key, then shows the week as submitted and read-only', async () => {
    const { server } = startServer(populatedWeek(START));
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(server.submits).toHaveLength(1);
    expect(server.submits[0]?.body).toEqual({ comment: null });
    expect(server.submits[0]?.key).toMatch(KEY);

    expect(await screen.findByText('Week submitted for approval.')).toBeInTheDocument();
    const banner = await screen.findByText(/This week is submitted and read-only\./);
    expect(banner.textContent?.replace(/\s/g, ' ')).toContain('Submitted Oct 24, 2026, 3:41 PM.');
    const summary = screen.getByRole('region', { name: 'Weekly summary' });
    expect(within(summary).getByText('Submitted', { selector: '.badge' })).toBeInTheDocument();
    for (const name of [/submit week/i, /^Add entry$/, /^Edit entry/, /^Delete entry/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getAllByTestId('entry-card')).toHaveLength(2); // still readable
  });

  it('sends the trimmed comment', async () => {
    const { server } = startServer(populatedWeek(START));
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText(/Comment for your manager/), '  Please review  ');
    expect(within(dialog).getByText('17 / 500 characters')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    await waitFor(() => expect(server.submits).toHaveLength(1));
    expect(server.submits[0]?.body).toEqual({ comment: 'Please review' });
  });

  it('cannot be double-submitted while the request is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let posts = 0;
    mockApi({
      'GET /auth/me': () => ({ body: USER }),
      'GET /meta': () => ({ body: META }),
      [`GET /timesheets/weeks/${START}`]: () => ({ body: populatedWeek(START) }),
      [`POST /timesheets/weeks/${START}/submit`]: async () => {
        posts += 1;
        await gate;
        return { body: { ...populatedWeek(START), status: 'SUBMITTED', is_editable: false } };
      },
    });
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    const busy = await within(dialog).findByRole('button', { name: 'Submitting…' });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.click(busy);
    release();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(posts).toBe(1);
  });
});

describe('When submission is refused', () => {
  const refuse = () => ({
    status: 422,
    body: {
      error: {
        code: 'BUSINESS_RULE_VIOLATION',
        message: 'The week cannot be submitted yet.',
        field_errors: {
          [`entries.${entries()[0]?.id}.hours`]: 'Hours cannot exceed 6 per entry.',
          'day.2026-10-20': 'Total for this day is 17.00 h, above the daily limit of 16.00 h.',
          week: 'Total for the week is 37.00 h, above the weekly limit of 30.00 h.',
        },
        request_id: 'r-sub',
      },
    },
  });

  it('explains every problem in plain words and keeps the dialog open', async () => {
    const { server } = startServer(populatedWeek(START), refuse);
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This week cannot be submitted yet.');
    const items = within(alert)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'PRJ-001 on Monday, October 19: Hours cannot exceed 6 per entry.',
      'Tuesday, October 20: Total for this day is 17.00 h, above the daily limit of 16.00 h.',
      'Total for the week is 37.00 h, above the weekly limit of 30.00 h.',
    ]);
    expect(screen.queryByText('Week submitted for approval.')).not.toBeInTheDocument();
    expect(server.week.status).toBe('DRAFT');
    expect(within(dialog).getByRole('button', { name: 'Submit week' })).toBeEnabled();
  });

  it('reuses the same idempotency key when the user retries, but not for a new dialog', async () => {
    let attempts = 0;
    const { server } = startServer(populatedWeek(START), (s) => {
      attempts += 1;
      if (attempts < 3) return refuse();
      s.week = { ...s.week, status: 'SUBMITTED', is_editable: false };
      return { body: s.week };
    });
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);

    let dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    await waitFor(() => expect(server.submits).toHaveLength(2));
    const [first, second] = server.submits;
    expect(second?.key).toBe(first?.key); // a retry of the same action

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    await waitFor(() => expect(server.submits).toHaveLength(3));
    expect(server.submits[2]?.key).not.toBe(first?.key); // a fresh action gets a fresh key
    expect(server.submits[2]?.key).toMatch(KEY);
  });

  it('moves focus to the error so keyboard users stay in the dialog and Escape still works', async () => {
    startServer(populatedWeek(START), refuse);
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    const alert = await within(dialog).findByRole('alert');
    // The clicked button was disabled while pending (which drops focus); focus must not be lost.
    await waitFor(() => expect(alert).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit week' })).toHaveFocus());
  });

  it('sends one request even when the confirm button is clicked twice instantly', async () => {
    const { server } = startServer(populatedWeek(START));
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    const confirm = within(dialog).getByRole('button', { name: 'Submit week' });
    // Two clicks in the same tick: React has not yet re-rendered the button as disabled.
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(server.submits).toHaveLength(1);
  });

  it('shows a conflict message (e.g. already submitted elsewhere) and refreshes the week', async () => {
    const { server } = startServer(populatedWeek(START), (s) => {
      s.week = { ...s.week, status: 'SUBMITTED', is_editable: false };
      return errorBody(
        'INVALID_TRANSITION',
        'This week is submitted and cannot be submitted.',
        409,
      );
    });
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    expect(
      await within(dialog).findByText(/is submitted and cannot be submitted/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // the page now reflects the real state: submitted and read-only
    expect(await screen.findByText(/This week is submitted and read-only\./)).toBeInTheDocument();
    expect(server.submits).toHaveLength(1);
  });

  it('shows a network failure and lets the user try again', async () => {
    let calls = 0;
    startServer(populatedWeek(START), () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Submit week' }));
    expect(await within(dialog).findByText(/Unable to reach the server/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Submit week' })).toBeEnabled();
    expect(calls).toBe(1);
  });
});

describe('Resubmitting a rejected week', () => {
  it('uses the resubmit wording and works the same way', async () => {
    const rejected = {
      ...weekFromEntries(START, [entry({ id: 'r1', work_date: START })]),
      status: 'REJECTED' as const,
      review_comment: 'Please correct Tuesday.',
    };
    const { server } = startServer(rejected);
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    expect(await screen.findByText(/Please correct Tuesday\./)).toBeInTheDocument();
    const dialog = await openDialog(user, 'Resubmit week');
    expect(dialog).toHaveAccessibleName('Resubmit this week?');
    await user.click(within(dialog).getByRole('button', { name: 'Resubmit week' }));
    await waitFor(() => expect(server.submits).toHaveLength(1));
    expect(await screen.findByText('Week submitted for approval.')).toBeInTheDocument();
  });
});
