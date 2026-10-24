import type { ReactNode } from 'react';
import type { TimesheetWeek } from '../../api/types';
import { formatHours } from '../../utils/hours';
import { TimesheetStatusBadge } from './TimesheetStatusBadge';

export function WeeklySummary({ week, actions }: { week: TimesheetWeek; actions?: ReactNode }) {
  const { summary } = week;
  const stats: Array<[label: string, value: string, testId: string]> = [
    ['Total hours', formatHours(summary.total_hours), 'total-hours'],
    ['Capped hours', formatHours(summary.capped_hours), 'capped-hours'],
    ['Non-capped hours', formatHours(summary.non_capped_hours), 'non-capped-hours'],
    ['Entries', String(summary.entry_count), 'entry-count'],
    ['Draft entries', String(summary.draft_count), 'draft-count'],
  ];
  return (
    <section className="card summary" aria-labelledby="summary-heading">
      <div className="summary-head">
        <h2 id="summary-heading">Weekly summary</h2>
        <span className="status-line">
          Status: <TimesheetStatusBadge status={week.status} />
        </span>
        {actions}
      </div>
      <dl className="stats">
        {stats.map(([label, value, testId]) => (
          <div className="stat" key={testId}>
            <dt>{label}</dt>
            <dd data-testid={testId}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
