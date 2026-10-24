import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalDetail, ApprovalListItem } from '../../api/types';
import { ALEX, META, MANAGER, USER, approvalDetail, approvalItem } from '../../test/fixtures';
import { errorBody, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const KEY = /^[A-Za-z0-9_-]{8,100}$/;

interface ListCall {
  status: string | null;
  page: string | null;
  pageSize: string | null;
  week: string | null;
}

/** A fake of the approvals API: a list endpoint that honours paging, and a mutable detail. */
function startApi(
  options: {
    user?: typeof MANAGER;
    items?: ApprovalListItem[];
    total?: number;
    detail?: ApprovalDetail;
    decide?: (
      action: 'approve' | 'reject',
      body: { comment: string | null },
      key: string,
    ) => ReturnType<Parameters<typeof mockApi>[0][string]>;
  } = {},
) {
  const calls: ListCall[] = [];
  const decisions: Array<{ action: string; body: { comment: string | null }; key: string }> = [];
  const state = { detail: options.detail ?? approvalDetail() };
  const items = options.items ?? [approvalItem()];
  const api = mockApi({
    'GET /auth/me': () => ({ body: options.user ?? MANAGER }),
    'GET /meta': () => ({ body: META }),
    'GET /approvals': (url) => {
      const q = url.searchParams;
      calls.push({
        status: q.get('status'),
        page: q.get('page'),
        pageSize: q.get('page_size'),
        week: q.get('week_start_date'),
      });
      return {
        body: {
          items: items.map((i) => ({
            ...i,
            status: (q.get('status') ?? 'SUBMITTED') as ApprovalListItem['status'],
          })),
          page: Number(q.get('page') ?? 1),
          page_size: Number(q.get('page_size') ?? 10),
          total: options.total ?? items.length,
        },
      };
    },
    'GET /approvals/w-1': () => ({ body: state.detail }),
    ...Object.fromEntries(
      (['approve', 'reject'] as const).map((action) => [
        `POST /approvals/w-1/${action}`,
        (_url: URL, init: RequestInit) => {
          const headers = init.headers as Record<string, string>;
          const body = JSON.parse(String(init.body));
          const key = headers['Idempotency-Key'] as string;
          decisions.push({ action, body, key });
          if (options.decide) return options.decide(action, body, key);
          state.detail = {
            ...state.detail,
            week: {
              ...state.detail.week,
              status: action === 'approve' ? 'APPROVED' : 'REJECTED',
              review_comment: body.comment,
              reviewed_by_name: 'Morgan Manager',
              reviewed_at: '2026-10-25T09:00:00Z',
            },
            history: [
              ...state.detail.history,
              {
                action: action === 'approve' ? 'APPROVED' : 'REJECTED',
                actor: { id: 'm', display_name: 'Morgan Manager', email: 'manager@example.test' },
                comment: body.comment,
                created_at: '2026-10-25T09:00:00Z',
              },
            ],
          };
          return { body: state.detail };
        },
      ]),
    ),
  });
  return { ...api, calls, decisions, state };
}

// ------------------------------------------------------------------- access and nav

describe('navigation and access', () => {
  it('shows employees only their timesheet and refuses the approvals page', async () => {
    const { calls } = startApi({ user: USER as typeof MANAGER });
    renderApp('/approvals');
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Timesheet' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Approvals/ })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0); // the page never even asked for the data
  });

  it('shows managers an Approvals link with the number waiting', async () => {
    startApi({ items: [approvalItem()], total: 3 });
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const link = await within(nav).findByRole('link', { name: /Approvals/ });
    await waitFor(() => expect(link).toHaveTextContent('3'));
    expect(link).toHaveAccessibleName('Approvals 3 waiting for review');
  });

  it('omits the badge when nothing is waiting', async () => {
    startApi({ items: [], total: 0 });
    renderApp('/');
    const link = await screen.findByRole('link', { name: 'Approvals' });
    expect(link.querySelector('.count-badge')).toBeNull();
  });

  it('marks the current page in the navigation', async () => {
    startApi();
    renderApp('/approvals');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: /Approvals/ })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expect(within(nav).getByRole('link', { name: 'Timesheet' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

// ------------------------------------------------------------------------------ list

describe('approvals list', () => {
  it('lists waiting timesheets with who, which week, when, and how much', async () => {
    const { calls } = startApi({
      items: [
        approvalItem(),
        approvalItem({
          week_id: 'w-2',
          employee: { ...ALEX, id: 'u2', display_name: 'Sam Employee' },
          total_hours: '40',
          entry_count: 5,
        }),
      ],
    });
    renderApp('/approvals');
    const rows = await screen.findAllByTestId('approval-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Alex Employee');
    expect(rows[0]).toHaveTextContent('Oct 19 – Oct 25, 2026');
    expect(rows[0]?.textContent?.replace(/\s/g, ' ')).toContain('Oct 24, 2026, 3:41 PM'); // business timezone
    expect(rows[0]).toHaveTextContent('10.50');
    expect(rows[1]).toHaveTextContent('40.00');
    expect(
      within(rows[0] as HTMLElement).getByRole('link', {
        name: 'Review Alex Employee, Oct 19 – Oct 25, 2026',
      }),
    ).toHaveAttribute('href', '/approvals/w-1');
    expect(calls[0]).toEqual({ status: 'SUBMITTED', page: '1', pageSize: '10', week: null });
    expect(screen.getByRole('table')).toHaveAccessibleName(/Timesheets/);
  });

  it('switches status, shows who reviewed, and returns to the first page', async () => {
    const user = userEvent.setup();
    const { calls } = startApi({
      items: [
        approvalItem({ reviewed_at: '2026-10-25T09:00:00Z', reviewer_name: 'Morgan Manager' }),
      ],
      total: 25,
    });
    renderApp('/approvals?page=2');
    await screen.findAllByTestId('approval-row');
    await user.selectOptions(screen.getByLabelText('Show'), 'APPROVED');
    await waitFor(() => expect(calls.at(-1)?.status).toBe('APPROVED'));
    expect(calls.at(-1)?.page).toBe('1');
    expect(await screen.findByRole('columnheader', { name: 'Reviewed' })).toBeInTheDocument();
    expect(screen.getByTestId('approval-row')).toHaveTextContent('by Morgan Manager');
    expect(screen.getByRole('link', { name: /^View / })).toBeInTheDocument();
  });

  it('filters by week and can clear the filter', async () => {
    const user = userEvent.setup();
    const { calls } = startApi();
    renderApp('/approvals');
    await screen.findAllByTestId('approval-row');
    fireEvent.change(screen.getByLabelText(/Week containing/), { target: { value: '2026-10-21' } });
    await waitFor(() => expect(calls.at(-1)?.week).toBe('2026-10-21'));
    await user.click(await screen.findByRole('button', { name: 'Clear week' }));
    // The unfiltered list is already cached, so there may be no new request: check the screen.
    await waitFor(() => expect(screen.getByLabelText(/Week containing/)).toHaveValue(''));
    expect(screen.queryByRole('button', { name: 'Clear week' })).not.toBeInTheDocument();
    expect(await screen.findAllByTestId('approval-row')).toHaveLength(1);
  });

  it('pages through the results', async () => {
    const user = userEvent.setup();
    const { calls } = startApi({ total: 25 });
    renderApp('/approvals');
    expect(await screen.findByText('Page 1 of 3 · 25 timesheets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 3 · 25 timesheets')).toBeInTheDocument();
    expect(calls.at(-1)?.page).toBe('2');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Page 3 of 3 · 25 timesheets');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it.each([
    ['SUBMITTED', 'Nothing is waiting for your review.'],
    ['APPROVED', 'No approved timesheets match.'],
    ['REJECTED', 'No rejected timesheets match.'],
  ])('shows a clear empty state for %s', async (status, text) => {
    startApi({ items: [], total: 0 });
    renderApp(`/approvals?status=${status}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers a way back from an empty later page', async () => {
    const user = userEvent.setup();
    const { calls } = startApi({ items: [], total: 3 });
    renderApp('/approvals?page=4');
    await user.click(await screen.findByRole('button', { name: 'Back to the first page' }));
    await waitFor(() => expect(calls.at(-1)?.page).toBe('1'));
  });

  it('shows an error with a retry that recovers', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    mockApi({
      'GET /auth/me': () => ({ body: MANAGER }),
      'GET /meta': () => ({ body: META }),
      'GET /approvals': () => {
        attempts += 1;
        return attempts <= 2
          ? errorBody('INTERNAL_ERROR', 'An unexpected error occurred.', 500)
          : { body: { items: [approvalItem()], page: 1, page_size: 10, total: 1 } };
      },
    });
    renderApp('/approvals');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An unexpected error occurred.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByTestId('approval-row')).toHaveLength(1);
  });

  it('ignores a made-up status in the URL', async () => {
    const { calls } = startApi();
    renderApp('/approvals?status=DRAFT&page=-3');
    await screen.findAllByTestId('approval-row');
    expect(calls[0]).toMatchObject({ status: 'SUBMITTED', page: '1' });
  });
});

// -------------------------------------------------------------------------- review page

describe('review page', () => {
  it('presents the week, the employee note, the entries and the history', async () => {
    startApi();
    renderApp('/approvals/w-1');
    expect(await screen.findByRole('heading', { name: /Alex Employee/ })).toHaveTextContent(
      'Oct 19 – Oct 25, 2026',
    );
    expect(screen.getByRole('group', { name: 'Decision' })).toHaveTextContent('Total 10.50 hours');
    expect(screen.getByText(/Note from Alex Employee:/).closest('blockquote')).toHaveTextContent(
      'Please review',
    );
    expect(screen.getAllByTestId('day-card')).toHaveLength(7);
    expect(screen.getAllByTestId('entry-card')).toHaveLength(2);
    expect(screen.getByTestId('total-hours')).toHaveTextContent('10.50');
    const items = screen
      .getAllByRole('listitem')
      .filter((li) => li.className.includes('history-item'));
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Submitted by Alex Employee');
    // Managers review; they never edit.
    expect(screen.queryByRole('button', { name: /^(Edit|Delete) entry/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add entry' })).not.toBeInTheDocument();
  });

  it.each([
    ['APPROVED', /This week was approved by Morgan Manager/, 'Comment: Well done'],
    [
      'REJECTED',
      /This week was rejected; it is with the employee by Morgan Manager/,
      'Reason: Fix Tuesday please',
    ],
  ] as const)(
    'shows the %s outcome and offers no further decision',
    async (status, headline, comment) => {
      const base = approvalDetail();
      startApi({
        detail: {
          ...base,
          week: {
            ...base.week,
            status,
            review_comment: comment.split(': ')[1] as string,
            reviewed_by_name: 'Morgan Manager',
            reviewed_at: '2026-10-25T09:00:00Z',
          },
        },
      });
      renderApp('/approvals/w-1');
      const banner = await screen.findByText(headline);
      expect(banner).toHaveTextContent(comment);
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    },
  );

  it('says "not found" without revealing why (missing, someone else\'s, or a draft)', async () => {
    mockApi({
      'GET /auth/me': () => ({ body: MANAGER }),
      'GET /meta': () => ({ body: META }),
      'GET /approvals': () => ({ body: { items: [], page: 1, page_size: 1, total: 0 } }),
      'GET /approvals/w-1': () => errorBody('NOT_FOUND', 'Timesheet not found.', 404),
    });
    renderApp('/approvals/w-1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Timesheet not found');
    expect(alert).toHaveTextContent('does not exist, or it is not one you are allowed to review');
    expect(within(alert).getByRole('link', { name: /Back to approvals/ })).toHaveAttribute(
      'href',
      '/approvals',
    );
  });

  it('explains that nobody reviews their own timesheet', async () => {
    mockApi({
      'GET /auth/me': () => ({ body: MANAGER }),
      'GET /meta': () => ({ body: META }),
      'GET /approvals': () => ({ body: { items: [], page: 1, page_size: 1, total: 0 } }),
      'GET /approvals/w-1': () =>
        errorBody('FORBIDDEN', 'You cannot review your own timesheet.', 403),
    });
    renderApp('/approvals/w-1');
    expect(
      await screen.findByRole('heading', { name: 'You cannot review this timesheet' }),
    ).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------ approve/reject

const openDialog = async (user: ReturnType<typeof userEvent.setup>, name: 'Approve' | 'Reject') => {
  await user.click(await screen.findByRole('button', { name }));
  return screen.findByRole('alertdialog');
};

describe('approving', () => {
  it('confirms, sends one request with a key, and shows the week as approved', async () => {
    const user = userEvent.setup();
    const { decisions } = startApi();
    renderApp('/approvals/w-1');
    const dialog = await openDialog(user, 'Approve');
    expect(dialog).toHaveAccessibleName('Approve this week?');
    expect(dialog).toHaveTextContent('Alex Employee');
    expect(dialog).toHaveTextContent('10.50 hours in 2 entries');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.type(within(dialog).getByLabelText(/Comment for the employee/), '  Thanks  ');
    await user.click(within(dialog).getByRole('button', { name: 'Approve week' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(decisions).toEqual([
      { action: 'approve', body: { comment: 'Thanks' }, key: expect.stringMatching(KEY) },
    ]);
    expect(await screen.findByText('Week approved.')).toBeInTheDocument();
    expect(await screen.findByText(/This week was approved by Morgan Manager/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('sends no comment when none is typed, and nothing when cancelled', async () => {
    const user = userEvent.setup();
    const { decisions } = startApi();
    renderApp('/approvals/w-1');
    let dialog = await openDialog(user, 'Approve');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(decisions).toHaveLength(0);
    dialog = await openDialog(user, 'Approve');
    await user.click(within(dialog).getByRole('button', { name: 'Approve week' }));
    await waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]?.body).toEqual({ comment: null });
  });
});

describe('rejecting', () => {
  it('insists on a reason before sending anything, and moves focus to the message', async () => {
    const user = userEvent.setup();
    const { decisions } = startApi();
    renderApp('/approvals/w-1');
    const dialog = await openDialog(user, 'Reject');
    expect(dialog).toHaveAccessibleName('Reject this week?');
    const reason = within(dialog).getByLabelText(/Reason for rejection/);
    expect(reason).toHaveAttribute('aria-required', 'true');

    await user.click(within(dialog).getByRole('button', { name: 'Reject week' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('at least 5 characters');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(decisions).toHaveLength(0);

    await user.type(reason, 'no'); // still too short
    await user.click(within(dialog).getByRole('button', { name: 'Reject week' }));
    expect(decisions).toHaveLength(0);
    expect(reason).toHaveAttribute('aria-invalid', 'true'); // two characters is still not a reason
    await user.type(reason, ' - the Tuesday hours look wrong');
    expect(reason).not.toHaveAttribute('aria-invalid', 'true'); // typing clears the complaint
  });

  it('sends the trimmed reason and shows the rejection', async () => {
    const user = userEvent.setup();
    const { decisions } = startApi();
    renderApp('/approvals/w-1');
    const dialog = await openDialog(user, 'Reject');
    await user.type(
      within(dialog).getByLabelText(/Reason for rejection/),
      '  Fix Tuesday please  ',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reject week' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(decisions).toEqual([
      {
        action: 'reject',
        body: { comment: 'Fix Tuesday please' },
        key: expect.stringMatching(KEY),
      },
    ]);
    expect(
      await screen.findByText('Week rejected and returned to the employee.'),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Reason: Fix Tuesday please/)).toBeInTheDocument();
  });

  it("shows the server's message for the reason and keeps what was typed", async () => {
    const user = userEvent.setup();
    startApi({
      decide: () => ({
        status: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The request contains invalid fields.',
            field_errors: { comment: 'Explain why the week is rejected (at least 5 characters).' },
            request_id: 'r',
          },
        },
      }),
    });
    renderApp('/approvals/w-1');
    const dialog = await openDialog(user, 'Reject');
    await user.type(within(dialog).getByLabelText(/Reason for rejection/), 'valid enough');
    await user.click(within(dialog).getByRole('button', { name: 'Reject week' }));
    expect(await within(dialog).findByText(/at least 5 characters/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason for rejection/)).toHaveValue('valid enough');
  });
});

describe('decision safety', () => {
  it('sends one request for two instant clicks', async () => {
    const user = userEvent.setup();
    const { decisions } = startApi();
    renderApp('/approvals/w-1');
    const dialog = await openDialog(user, 'Approve');
    const confirm = within(dialog).getByRole('button', { name: 'Approve week' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(decisions).toHaveLength(1);
  });

  it('reuses the key when retrying after a failure, and uses a new one for a new dialog', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { decisions, state } = startApi({
      decide: (_action, _body, _key) => {
        attempts += 1;
        if (attempts < 3) return errorBody('INTERNAL_ERROR', 'Temporary problem.', 503) as never;
        return { body: state.detail };
      },
    });
    renderApp('/approvals/w-1');
    let dialog = await openDialog(user, 'Approve');
    await user.click(within(dialog).getByRole('button', { name: 'Approve week' }));
    await within(dialog).findByText(/Temporary problem/);
    await user.click(within(dialog).getByRole('button', { name: 'Approve week' }));
    await waitFor(() => expect(decisions).toHaveLength(2));
    expect(decisions[1]?.key).toBe(decisions[0]?.key);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    dialog = await openDialog(user, 'Approve');
    await user.click(within(dialog).getByRole('button', { name: 'Approve week' }));
    await waitFor(() => expect(decisions).toHaveLength(3));
    expect(decisions[2]?.key).not.toBe(decisions[0]?.key);
  });

  it('explains a conflict (already decided elsewhere) and refreshes the page behind it', async () => {
    const user = userEvent.setup();
    const { state } = startApi({
      decide: () =>
        errorBody(
          'INVALID_TRANSITION',
          'This week is approved; only a submitted week can be approved.',
          409,
        ) as never,
    });
    renderApp('/approvals/w-1');
    const dialog = await openDialog(user, 'Approve');
    // Meanwhile someone else decided:
    state.detail = {
      ...state.detail,
      week: {
        ...state.detail.week,
        status: 'APPROVED',
        reviewed_by_name: 'Riley Admin',
        reviewed_at: '2026-10-25T09:00:00Z',
      },
    };
    await user.click(within(dialog).getByRole('button', { name: 'Approve week' }));
    expect(
      await within(dialog).findByText(/only a submitted week can be approved/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/This week was approved by Riley Admin/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});
