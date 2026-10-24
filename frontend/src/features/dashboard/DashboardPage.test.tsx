import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { META, USER, populatedWeek, week } from '../../test/fixtures';
import { errorBody, mockApi } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const signedIn = {
  'GET /auth/me': () => ({ body: USER }),
  'GET /meta': () => ({ body: META }),
};

describe('Dashboard', () => {
  it('loads the current week from the API and renders cards, summary and entries', async () => {
    const { calls } = mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({ body: populatedWeek('2026-10-19') }),
    });
    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: 'Oct 19 – Oct 25, 2026' }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('day-card')).toHaveLength(7);
    expect(screen.getByTestId('total-hours')).toHaveTextContent('10.50');
    expect(screen.getAllByTestId('entry-card')).toHaveLength(2);
    // The week to load came from the server's notion of "today", not the browser clock.
    expect(calls).toContain('GET /meta');
    expect(calls).toContain('GET /timesheets/weeks/2026-10-19');
    // Fri Oct 23 is "today" per /meta.
    const today = screen
      .getAllByTestId('day-card')
      .find((card) => card.textContent?.includes('Today'));
    expect(today).toHaveTextContent('Fri');
    expect(screen.getByRole('button', { name: /current week/i })).toBeDisabled();
  });

  it('announces the loaded week in a polite live region', async () => {
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({ body: populatedWeek('2026-10-19') }),
    });
    renderApp('/');
    const status = await screen.findByText(
      /Showing Oct 19 – Oct 25, 2026\. Total 10\.50 hours in 2 entries/,
    );
    expect(status.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('navigates to the next and previous weeks and fetches each', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({ body: populatedWeek('2026-10-19') }),
      'GET /timesheets/weeks/2026-10-26': () => ({ body: week('2026-10-26') }),
      'GET /timesheets/weeks/2026-10-12': () => ({ body: week('2026-10-12') }),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Oct 19 – Oct 25, 2026' });

    await user.click(screen.getByRole('button', { name: /next week/i }));
    expect(
      await screen.findByRole('heading', { name: 'Oct 26 – Nov 1, 2026' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No time entries this week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /current week/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /current week/i }));
    expect(
      await screen.findByRole('heading', { name: 'Oct 19 – Oct 25, 2026' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /previous week/i }));
    expect(
      await screen.findByRole('heading', { name: 'Oct 12 – Oct 18, 2026' }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('GET /timesheets'))).toEqual(
      expect.arrayContaining([
        'GET /timesheets/weeks/2026-10-19',
        'GET /timesheets/weeks/2026-10-26',
        'GET /timesheets/weeks/2026-10-12',
      ]),
    );
  });

  it('loads the week named in the URL and canonicalises a mid-week date', async () => {
    const { calls } = mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-21': () => ({ body: week('2026-10-19') }),
    });
    renderApp('/?week=2026-10-21');
    expect(
      await screen.findByRole('heading', { name: 'Oct 19 – Oct 25, 2026' }),
    ).toBeInTheDocument();
    expect(calls).toContain('GET /timesheets/weeks/2026-10-21');
  });

  it('ignores an invalid ?week= value and falls back to the current week', async () => {
    const { calls } = mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({ body: week('2026-10-19') }),
    });
    renderApp('/?week=2026-02-30');
    expect(
      await screen.findByRole('heading', { name: 'Oct 19 – Oct 25, 2026' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.includes('2026-02-30'))).toBe(false);
  });

  it('shows a loading state, then an empty state for a week without entries', async () => {
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({ body: week('2026-10-19') }),
    });
    renderApp('/');
    expect(screen.getByRole('status', { name: /checking your session/i })).toBeInTheDocument();
    expect(await screen.findByText('No time entries this week')).toBeInTheDocument();
    expect(screen.getAllByTestId('day-card')).toHaveLength(7);
    expect(screen.getByTestId('total-hours')).toHaveTextContent('0.00');
  });

  it('shows an error with a retry that recovers', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => {
        attempts += 1;
        return attempts === 1
          ? errorBody('INTERNAL_ERROR', 'An unexpected error occurred.', 500)
          : { body: populatedWeek('2026-10-19') };
      },
    });
    renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An unexpected error occurred.');
    expect(alert).toHaveTextContent('req-test-0001');

    await user.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByTestId('total-hours')).toHaveTextContent('10.50');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the rejection reason for a rejected week and keeps it editable', async () => {
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({
        body: {
          ...populatedWeek('2026-10-19'),
          status: 'REJECTED',
          review_comment: 'Please correct the hours recorded for Wednesday.',
        },
      }),
    });
    renderApp('/');
    expect(await screen.findByText(/This week was rejected/)).toBeInTheDocument();
    expect(
      screen.getByText(/Please correct the hours recorded for Wednesday\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
  });

  it('tells the employee who rejected the week, when, and why', async () => {
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({
        body: {
          ...populatedWeek('2026-10-19'),
          status: 'REJECTED',
          review_comment: 'Please correct the hours recorded for Wednesday.',
          reviewed_by_name: 'Morgan Manager',
          reviewed_at: '2026-10-25T09:00:00Z',
        },
      }),
    });
    renderApp('/');
    const banner = await screen.findByText(/This week was rejected\./);
    const text = banner.parentElement?.textContent?.replace(/\s/g, ' ') ?? '';
    expect(text).toContain('Reason: Please correct the hours recorded for Wednesday.');
    expect(text).toContain('Reviewed by Morgan Manager, Oct 25, 2026, 2:30 PM.'); // business timezone
    expect(screen.getByRole('button', { name: 'Resubmit week' })).toBeInTheDocument();
  });

  it('shows an approved week as final, with who approved it and any comment', async () => {
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({
        body: {
          ...populatedWeek('2026-10-19'),
          status: 'APPROVED',
          is_editable: false,
          review_comment: 'Well done',
          reviewed_by_name: 'Morgan Manager',
          reviewed_at: '2026-10-25T09:00:00Z',
        },
      }),
    });
    renderApp('/');
    const banner = await screen.findByText(/This week is approved and read-only\./);
    const text = banner.textContent?.replace(/\s/g, ' ') ?? '';
    expect(text).toContain('Reviewed by Morgan Manager, Oct 25, 2026, 2:30 PM.');
    expect(text).toContain('Comment: Well done');
    expect(
      screen.queryByRole('button', { name: /submit week|resubmit week|Add entry/i }),
    ).not.toBeInTheDocument();
  });

  it('marks a submitted week as read-only and reports zero draft entries', async () => {
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () => ({
        body: {
          ...populatedWeek('2026-10-19'),
          status: 'SUBMITTED',
          is_editable: false,
          summary: { ...populatedWeek().summary, draft_count: 0 },
        },
      }),
    });
    renderApp('/');
    expect(await screen.findByText(/This week is submitted and read-only/)).toBeInTheDocument();
    expect(screen.getByTestId('draft-count')).toHaveTextContent('0');
  });

  it('returns to sign-in with a notice when the session expires mid-use', async () => {
    mockApi({
      ...signedIn,
      'GET /timesheets/weeks/2026-10-19': () =>
        errorBody('UNAUTHENTICATED', 'Authentication is required.', 401),
    });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: /sign in to timetrack/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/session has ended/i)).toBeInTheDocument();
  });
});
