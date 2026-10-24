import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchHoursReport, hoursCsvUrl, type ReportQuery } from '../../api/endpoints';
import type { GroupBy, WeekStatus } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LiveRegion } from '../../components/LiveRegion';
import { Pager } from '../../components/Pager';
import { useMeta } from '../../hooks/useMeta';
import { addDays, formatWeekRange, isValidIsoDate } from '../../utils/dates';
import { formatHours } from '../../utils/hours';

const PAGE_SIZE = 20;
const GROUPS: Array<[GroupBy, string, string]> = [
  ['employee', 'Person', 'Person'],
  ['project', 'Project', 'Project'],
  ['earning_code', 'Earning code', 'Earning code'],
  ['week', 'Week', 'Week'],
];
// Drafts are work in progress and never appear in reports.
const STATUSES: Array<[Exclude<WeekStatus, 'DRAFT'>, string]> = [
  ['APPROVED', 'Approved'],
  ['SUBMITTED', 'Waiting for review'],
  ['REJECTED', 'Rejected'],
];
const MAX_DAYS = 366;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const meta = useMeta();
  const today = meta.data?.today;

  useEffect(() => {
    document.title = 'Reports · TimeTrack';
  }, []);

  // Default: the last 28 days up to the server's "today", until the person chooses otherwise.
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const dateTo = isValidIsoDate(rawTo) ? rawTo : (today ?? '');
  const dateFrom = isValidIsoDate(rawFrom) ? rawFrom : dateTo ? addDays(dateTo, -27) : '';
  const groupBy = (GROUPS.find(([value]) => value === params.get('group'))?.[0] ??
    'employee') as GroupBy;
  const statusParams = params.getAll('status');
  const chosenStatuses = STATUSES.map(([value]) => value).filter((value) =>
    statusParams.includes(value),
  );
  const statuses: WeekStatus[] = chosenStatuses.length > 0 ? chosenStatuses : ['APPROVED'];
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);

  const rangeProblem =
    dateFrom && dateTo
      ? dateFrom > dateTo
        ? 'The start date must not be after the end date.'
        : daysBetween(dateFrom, dateTo) + 1 > MAX_DAYS
          ? `Choose a range of at most ${MAX_DAYS} days.`
          : null
      : null;

  const query: ReportQuery = { dateFrom, dateTo, groupBy, statuses };
  const report = useQuery({
    queryKey: ['report', dateFrom, dateTo, groupBy, statuses.join(','), page],
    queryFn: () => fetchHoursReport({ ...query, page, pageSize: PAGE_SIZE }),
    enabled: Boolean(dateFrom && dateTo) && !rangeProblem,
    placeholderData: (previous) => previous,
  });
  const data = report.data;

  const update = (changes: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value) next.set(key, value);
    }
    setParams(next);
  };

  const groupLabel = GROUPS.find(([value]) => value === groupBy)?.[1] ?? 'Group';

  return (
    <div className="reports">
      <h1>Reports</h1>
      <p className="hint">
        Hours by {groupLabel.toLowerCase()}. Managers see their own reports; administrators see
        everyone. Drafts are never included.
      </p>
      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label htmlFor="report-from">From</label>
          <input
            id="report-from"
            type="date"
            value={dateFrom}
            onChange={(event) => update({ from: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="report-to">To</label>
          <input
            id="report-to"
            type="date"
            value={dateTo}
            onChange={(event) => update({ to: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="report-group">Group by</label>
          <select
            id="report-group"
            value={groupBy}
            onChange={(event) => update({ group: event.target.value })}
          >
            {GROUPS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="field status-set">
          <legend>Weeks that are</legend>
          {STATUSES.map(([value, label]) => (
            <label key={value} className="check-row">
              <input
                type="checkbox"
                checked={statuses.includes(value)}
                // At least one status must stay ticked: an empty selection would mean "default".
                disabled={statuses.length === 1 && statuses.includes(value)}
                onChange={(event) =>
                  update({
                    status: event.target.checked
                      ? [...statuses, value]
                      : statuses.filter((s) => s !== value),
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
      </form>

      {rangeProblem ? (
        <p className="form-error" role="alert">
          {rangeProblem}
        </p>
      ) : null}

      <LiveRegion
        message={
          data
            ? `${data.total} ${data.total === 1 ? 'row' : 'rows'}. Total ${formatHours(data.totals.total_hours)} hours.`
            : ''
        }
      />

      {rangeProblem ? null : report.isError && !data ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : !data ? (
        <div className="skeleton skeleton-block tall" role="status" aria-label="Loading report" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No hours in this range">
          Try a longer range or include weeks that are still waiting for review.
        </EmptyState>
      ) : (
        <>
          <div className="report-actions">
            <a className="btn btn-secondary" href={hoursCsvUrl(query)} download>
              Download CSV
            </a>
            <span className="hint">All rows, not just this page.</span>
          </div>
          <table className="data-table" data-testid="report-table">
            <caption className="sr-only">Hours by {groupLabel.toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col">{groupLabel}</th>
                <th scope="col">Total hours</th>
                <th scope="col">Capped</th>
                <th scope="col">Non-capped</th>
                <th scope="col">Entries</th>
                <th scope="col">People</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.key} data-testid="report-row">
                  <th scope="row" data-label={groupLabel}>
                    {groupBy === 'week' && isValidIsoDate(row.key)
                      ? formatWeekRange(row.key, addDays(row.key, 6))
                      : row.label}
                    {row.detail ? <span className="muted small block">{row.detail}</span> : null}
                  </th>
                  <td data-label="Total hours">{formatHours(row.total_hours)}</td>
                  <td data-label="Capped">{formatHours(row.capped_hours)}</td>
                  <td data-label="Non-capped">{formatHours(row.non_capped_hours)}</td>
                  <td data-label="Entries">{row.entry_count}</td>
                  <td data-label="People">{row.employee_count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="report-totals">
                <th scope="row" data-label="Total (all rows)">
                  Total (all rows)
                </th>
                <td data-label="Total hours">{formatHours(data.totals.total_hours)}</td>
                <td data-label="Capped">{formatHours(data.totals.capped_hours)}</td>
                <td data-label="Non-capped">{formatHours(data.totals.non_capped_hours)}</td>
                <td data-label="Entries">{data.totals.entry_count}</td>
                <td data-label="People">{data.totals.employee_count}</td>
              </tr>
            </tfoot>
          </table>
          <Pager
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            noun="row"
            onPage={(next) => {
              const nextParams = new URLSearchParams(params);
              nextParams.set('page', String(next));
              setParams(nextParams);
            }}
          />
        </>
      )}
    </div>
  );
}
