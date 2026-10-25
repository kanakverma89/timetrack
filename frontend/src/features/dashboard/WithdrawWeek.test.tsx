import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimesheetWeek } from '../../api/types';
import { META, USER, populatedWeek } from '../../test/fixtures';
import { errorBody, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const START = '2026-10-19';

const submitted = (): TimesheetWeek => ({
  ...populatedWeek(START),
  status: 'SUBMITTED',
  is_editable: false,
  submitted_at: '2026-10-24T10:11:00Z',
  summary: { ...populatedWeek(START).summary, draft_count: 0 },
});

function startServer(
  initial: TimesheetWeek,
  withdrawHandler?: () => { status?: number; body?: unknown },
) {
  const state = { week: initial, withdraws: 0 };
  const api = mockApi({
    'GET /auth/me': () => ({ body: USER }),
    'GET /meta': () => ({ body: META }),
    [`GET /timesheets/weeks/${START}`]: () => ({ body: state.week }),
    [`POST /timesheets/weeks/${START}/withdraw`]: () => {
      state.withdraws += 1;
      if (withdrawHandler) return withdrawHandler();
      state.week = {
        ...populatedWeek(START),
        status: 'DRAFT',
        is_editable: true,
        submitted_at: null,
      };
      return { body: state.week };
    },
  });
  return { ...api, state };
}

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Withdraw submission' }));
  return screen.findByRole('alertdialog');
};

describe('Withdraw submission button', () => {
  it('is offered on a submitted week, with a reason to use it', async () => {
    startServer(submitted());
    renderApp(`/?week=${START}`);
    const button = await screen.findByRole('button', { name: 'Withdraw submission' });
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(
      'Waiting for your manager. Withdraw it to make changes.',
    );
  });

  it.each(['DRAFT', 'APPROVED', 'REJECTED'] as const)(
    'is not offered on a %s week',
    async (status) => {
      startServer({ ...populatedWeek(START), status, is_editable: status !== 'APPROVED' });
      renderApp(`/?week=${START}`);
      await screen.findByTestId('total-hours');
      expect(screen.queryByRole('button', { name: 'Withdraw submission' })).not.toBeInTheDocument();
    },
  );
});

describe('Withdraw submission dialog', () => {
  it('says what happens and puts the safe choice first', async () => {
    startServer(submitted());
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    expect(dialog).toHaveAccessibleName('Withdraw this submission?');
    expect(dialog).toHaveTextContent('Oct 19 – Oct 25, 2026');
    expect(dialog).toHaveTextContent('10.50 hours in 2 entries');
    expect(dialog).toHaveTextContent('becomes a draft again');
    expect(within(dialog).getByRole('button', { name: 'Keep submitted' })).toHaveFocus();
  });

  it('sends nothing when the person keeps the submission', async () => {
    const { state } = startServer(submitted());
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Keep submitted' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(state.withdraws).toBe(0);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Withdraw submission' })).toHaveFocus(),
    );
  });

  it('turns the week back into an editable draft', async () => {
    const { state } = startServer(submitted());
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw submission' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(state.withdraws).toBe(1);
    expect(
      await screen.findByText(
        'Submission withdrawn. This week is a draft again and can be edited.',
      ),
    ).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Weekly summary' });
    expect(within(summary).getByText('Draft', { selector: '.badge' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add entry' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Withdraw submission' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edit entry/ })).toHaveLength(2);
  });

  it('cannot be sent twice while the request is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let posts = 0;
    mockApi({
      'GET /auth/me': () => ({ body: USER }),
      'GET /meta': () => ({ body: META }),
      [`GET /timesheets/weeks/${START}`]: () => ({ body: submitted() }),
      [`POST /timesheets/weeks/${START}/withdraw`]: async () => {
        posts += 1;
        await gate;
        return { body: { ...populatedWeek(START), status: 'DRAFT', is_editable: true } };
      },
    });
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw submission' }));
    const busy = await within(dialog).findByRole('button', { name: 'Withdrawing…' });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Keep submitted' })).toBeDisabled();
    await user.click(busy);
    release();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(posts).toBe(1);
  });
});

describe('When the manager decided first', () => {
  it('shows the server message, keeps the dialog open and refreshes the week behind it', async () => {
    const approved: TimesheetWeek = { ...submitted(), status: 'APPROVED' };
    const { state } = startServer(submitted(), () => {
      state.week = approved; // the manager approved while the dialog was open
      return errorBody(
        'INVALID_TRANSITION',
        'This week has already been approved and can no longer be withdrawn.',
        409,
      );
    });
    const user = userEvent.setup();
    renderApp(`/?week=${START}`);
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw submission' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('already been approved and can no longer be withdrawn');

    await user.click(within(dialog).getByRole('button', { name: 'Keep submitted' }));
    const summary = screen.getByRole('region', { name: 'Weekly summary' });
    await waitFor(() =>
      expect(within(summary).getByText('Approved', { selector: '.badge' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Withdraw submission' })).not.toBeInTheDocument();
  });
});
