import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HoursReport, ReportRow } from '../../api/types';
import { MANAGER, META, USER } from '../../test/fixtures';
import { mockApi, errorBody } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

afterEach(() => vi.unstubAllGlobals());

const row = (o: Partial<ReportRow> = {}): ReportRow => ({
  key: 'u-alex',
  label: 'Alex Employee',
  detail: 'employee@example.test',
  total_hours: '10.5',
  capped_hours: '8',
  non_capped_hours: '2.5',
  entry_count: 2,
  employee_count: 1,
  ...o,
});

function report(items: ReportRow[], o: Partial<HoursReport> = {}): HoursReport {
  return {
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    group_by: 'employee',
    date_from: '2026-10-19',
    date_to: '2026-10-25',
    statuses: ['APPROVED'],
    totals: {
      total_hours: '10.5',
      capped_hours: '8',
      non_capped_hours: '2.5',
      entry_count: 2,
      employee_count: 1,
    },
    ...o,
  };
}

function reportsApi(
  respond: (q: URLSearchParams) => ReturnType<Parameters<typeof mockApi>[0][string]> = () => ({
    body: report([row()]),
  }),
  user = MANAGER,
) {
  const queries: URLSearchParams[] = [];
  const api = mockApi({
    'GET /auth/me': () => ({ body: user }),
    'GET /meta': () => ({ body: META }),
    'GET /approvals': () => ({ body: { items: [], page: 1, page_size: 1, total: 0 } }),
    'GET /reports/hours': (url) => {
      queries.push(url.searchParams);
      return respond(url.searchParams);
    },
  });
  return { ...api, queries };
}

const URL_ = '/reports?from=2026-10-19&to=2026-10-25';

describe('hours report', () => {
  it('turns the address into the request and shows rows, totals and a count', async () => {
    const { queries } = reportsApi();
    renderApp(`${URL_}&group=project&status=APPROVED&status=SUBMITTED`);
    const rows = await screen.findAllByTestId('report-row');
    expect(rows).toHaveLength(1);
    const q = queries[0]!;
    expect(q.get('date_from')).toBe('2026-10-19');
    expect(q.get('date_to')).toBe('2026-10-25');
    expect(q.get('group_by')).toBe('project');
    expect(q.getAll('status')).toEqual(['APPROVED', 'SUBMITTED']);
    expect(q.get('page_size')).toBe('20');

    const first = rows[0]!;
    expect(first).toHaveTextContent('Alex Employee');
    expect(first.querySelector('[data-label="Total hours"]')).toHaveTextContent('10.50');
    expect(first.querySelector('[data-label="Capped"]')).toHaveTextContent('8.00');
    expect(first.querySelector('[data-label="Non-capped"]')).toHaveTextContent('2.50');
    const totals = screen.getByTestId('report-totals');
    expect(within(totals).getByText('Total (all rows)', { selector: 'th' })).toBeInTheDocument();
    expect(totals.querySelector('[data-label="Entries"]')).toHaveTextContent('2');
    expect(screen.getByText(/1 row\. Total 10\.50 hours\./)).toBeInTheDocument();
  });

  it('defaults to approved weeks only, ending on the server date, 28 days back', async () => {
    const { queries } = reportsApi();
    renderApp('/reports');
    await screen.findAllByTestId('report-row');
    expect(queries[0]!.get('date_to')).toBe(META.today); // the server's today, not the browser clock
    expect(queries[0]!.get('date_from')).toBe('2026-09-26');
    expect(queries[0]!.getAll('status')).toEqual(['APPROVED']);
    expect(screen.getByRole('checkbox', { name: 'Approved' })).toBeChecked();
  });

  it('always keeps at least one status ticked', async () => {
    reportsApi();
    renderApp(URL_);
    await screen.findAllByTestId('report-row');
    expect(screen.getByRole('checkbox', { name: 'Approved' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Waiting for review' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Approved' })).toBeEnabled());
  });

  it('asks again when the grouping, dates or statuses change', async () => {
    const { queries } = reportsApi();
    const user = userEvent.setup();
    renderApp(URL_);
    await screen.findAllByTestId('report-row');
    await user.selectOptions(screen.getByLabelText('Group by'), 'earning_code');
    await waitFor(() => expect(queries.at(-1)?.get('group_by')).toBe('earning_code'));
    await user.click(screen.getByRole('checkbox', { name: 'Rejected' }));
    await waitFor(() => expect(queries.at(-1)?.getAll('status')).toEqual(['APPROVED', 'REJECTED']));
    expect(queries.at(-1)?.get('page')).toBe('1');
  });

  it('shows weeks as ranges, not raw dates', async () => {
    reportsApi(() => ({
      body: report([row({ key: '2026-10-19', label: '2026-10-19', detail: null })], {
        group_by: 'week',
      }),
    }));
    renderApp(`${URL_}&group=week`);
    expect(await screen.findByTestId('report-row')).toHaveTextContent('Oct 19 – Oct 25, 2026');
  });

  it('links the CSV to the same filters, for every row', async () => {
    reportsApi();
    renderApp(`${URL_}&group=project&status=APPROVED&status=REJECTED`);
    const link = await screen.findByRole('link', { name: 'Download CSV' });
    const href = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(href.pathname).toBe('/api/v1/reports/hours.csv');
    expect(href.searchParams.get('group_by')).toBe('project');
    expect(href.searchParams.get('date_from')).toBe('2026-10-19');
    expect(href.searchParams.getAll('status')).toEqual(['APPROVED', 'REJECTED']);
    expect(href.searchParams.has('page')).toBe(false); // not just the visible page
    expect(link).toHaveAttribute('download');
  });

  it('refuses an impossible range without asking the server', async () => {
    const { calls } = reportsApi();
    renderApp('/reports?from=2026-10-25&to=2026-10-19');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start date must not be after the end date.',
    );
    expect(calls).not.toContain('GET /reports/hours');
    expect(screen.queryByTestId('report-table')).not.toBeInTheDocument();
  });

  it('refuses a range longer than a year', async () => {
    const { calls } = reportsApi();
    renderApp('/reports?from=2025-01-01&to=2026-10-19');
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 366 days');
    expect(calls).not.toContain('GET /reports/hours');
  });

  it('says so when there is nothing in the range, with no download offered', async () => {
    reportsApi(() => ({ body: report([]) }));
    renderApp(URL_);
    expect(await screen.findByText('No hours in this range')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download CSV' })).not.toBeInTheDocument();
  });

  it('pages through many rows without losing the filters', async () => {
    const { queries } = reportsApi((q) => ({
      body: report([row()], { total: 45, page: Number(q.get('page') ?? 1) }),
    }));
    const user = userEvent.setup();
    renderApp(`${URL_}&group=project`);
    await screen.findAllByTestId('report-row');
    expect(screen.getByText(/Page 1 of 3 · 45 rows/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(queries.at(-1)?.get('page')).toBe('2'));
    expect(queries.at(-1)?.get('group_by')).toBe('project');
  });

  it('offers a retry when the report cannot be loaded', async () => {
    reportsApi(() => errorBody('INTERNAL_ERROR', 'The report failed.', 500));
    renderApp(URL_);
    expect(await screen.findByRole('alert')).toHaveTextContent('The report failed.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is not available to employees, who never reach the API', async () => {
    const { calls } = reportsApi(undefined, USER as typeof MANAGER);
    renderApp(URL_);
    expect(await screen.findByRole('heading', { name: /do not have access/i })).toBeInTheDocument();
    expect(calls).not.toContain('GET /reports/hours');
  });
});
