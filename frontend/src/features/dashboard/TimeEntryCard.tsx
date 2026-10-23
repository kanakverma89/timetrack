import type { TimeEntry, WeekStatus } from '../../api/types';
import { formatHours } from '../../utils/hours';
import { ExpandableText } from './ExpandableText';
import { TimesheetStatusBadge } from './TimesheetStatusBadge';

export function TimeEntryCard({ entry, status }: { entry: TimeEntry; status: WeekStatus }) {
  const classification = entry.earning_code.classification === 'CAPPED' ? 'Capped' : 'Non-capped';
  return (
    <li className="entry-card" data-testid="entry-card">
      <div className="entry-main">
        <p className="entry-project">
          <strong>{entry.project.code}</strong> {entry.project.name}
          {entry.task ? <span className="entry-task"> › {entry.task.name}</span> : null}
        </p>
        <ExpandableText text={entry.description} />
        <p className="entry-meta muted small">
          {entry.earning_code.name} ({entry.earning_code.code}) · {classification}
        </p>
      </div>
      <div className="entry-side">
        <span className="entry-hours">
          {formatHours(entry.hours)} <abbr title="hours">h</abbr>
        </span>
        <TimesheetStatusBadge status={status} />
      </div>
    </li>
  );
}
