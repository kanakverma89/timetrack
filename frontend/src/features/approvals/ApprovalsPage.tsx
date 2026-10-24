import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchApprovals } from '../../api/endpoints';
import type { WeekStatus } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LiveRegion } from '../../components/LiveRegion';
import { useMeta } from '../../hooks/useMeta';
import { formatTimestamp, formatWeekRange, isValidIsoDate } from '../../utils/dates';
import { formatHours } from '../../utils/hours';
import { TimesheetStatusBadge } from '../dashboard/TimesheetStatusBadge';

type Status = Exclude<WeekStatus, 'DRAFT'>;
const STATUSES: Array<[Status, string]> = [
  ['SUBMITTED', 'Waiting for review'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
];
const PAGE_SIZE = 10;

const EMPTY_TEXT: Record<Status, string> = {
  SUBMITTED: 'Nothing is waiting for your review.',
  APPROVED: 'No approved timesheets match.',
  REJECTED: 'No rejected timesheets match.',
};

function parseStatus(value: string | null): Status {
  return STATUSES.some(([status]) => status === value) ? (value as Status) : 'SUBMITTED';
}

export function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const status = parseStatus(params.get('status'));
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const weekParam = params.get('week');
  const week = isValidIsoDate(weekParam) ? weekParam : undefined;
  const meta = useMeta();
  const timeZone = meta.data?.business_timezone ?? 'UTC';

  const list = useQuery({
    queryKey: ['approvals', status, page, week ?? null],
    queryFn: () => fetchApprovals({ status, page, pageSize: PAGE_SIZE, week }),
    // Keep the previous page on screen while the next loads, so paging does not flash a skeleton.
    placeholderData: (previous) => previous,
  });

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const decided = status !== 'SUBMITTED';

  return (
    <div className="approvals">
      <h1>Approvals</h1>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label htmlFor="status-filter">Show</label>
          <select
            id="status-filter"
            value={status}
            onChange={(event) => update({ status: event.target.value, page: null })}
          >
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="week-filter">
            Week containing <span className="required">(optional)</span>
          </label>
          <input
            id="week-filter"
            type="date"
            value={week ?? ''}
            onChange={(event) => update({ week: event.target.value, page: null })}
          />
        </div>
        {week ? (
          <button
            type="button"
            className="btn btn-link"
            onClick={() => update({ week: null, page: null })}
          >
            Clear week
          </button>
        ) : null}
      </form>

      <LiveRegion
        message={
          data ? `${data.total} ${data.total === 1 ? 'timesheet' : 'timesheets'} found.` : ''
        }
      />

      {list.isError && !data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !data ? (
        <div
          className="skeleton skeleton-block tall"
          role="status"
          aria-busy="true"
          aria-label="Loading timesheets"
        />
      ) : data.items.length === 0 ? (
        page > 1 ? (
          <EmptyState title="No timesheets on this page">
            <button type="button" className="btn btn-link" onClick={() => update({ page: null })}>
              Back to the first page
            </button>
          </EmptyState>
        ) : (
          <EmptyState title={EMPTY_TEXT[status]}>
            {week ? 'Try clearing the week filter.' : undefined}
          </EmptyState>
        )
      ) : (
        <>
          <table className="approvals-table" data-testid="approvals-table">
            <caption className="sr-only">Timesheets, oldest submission first</caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Week</th>
                <th scope="col">{decided ? 'Reviewed' : 'Submitted'}</th>
                <th scope="col">Hours</th>
                <th scope="col">Entries</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const when = decided ? item.reviewed_at : item.submitted_at;
                return (
                  <tr key={item.week_id} data-testid="approval-row">
                    <th scope="row" data-label="Employee">
                      {item.employee.display_name}
                    </th>
                    <td data-label="Week">
                      {formatWeekRange(item.week_start_date, item.week_end_date)}
                    </td>
                    <td data-label={decided ? 'Reviewed' : 'Submitted'}>
                      {when ? formatTimestamp(when, timeZone) : '—'}
                      {decided && item.reviewer_name ? (
                        <span className="muted small"> by {item.reviewer_name}</span>
                      ) : null}
                    </td>
                    <td data-label="Hours">{formatHours(item.total_hours)}</td>
                    <td data-label="Entries">{item.entry_count}</td>
                    <td data-label="Status">
                      <TimesheetStatusBadge status={item.status} />
                    </td>
                    <td className="row-action">
                      <Link
                        className="btn btn-secondary btn-small"
                        to={`/approvals/${item.week_id}`}
                        aria-label={`${decided ? 'View' : 'Review'} ${item.employee.display_name}, ${formatWeekRange(item.week_start_date, item.week_end_date)}`}
                      >
                        {decided ? 'View' : 'Review'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <nav className="pager" aria-label="Pagination">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              Previous page
            </button>
            <span>
              Page {data.page} of {pages} · {data.total}{' '}
              {data.total === 1 ? 'timesheet' : 'timesheets'}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page >= pages}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next page
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
