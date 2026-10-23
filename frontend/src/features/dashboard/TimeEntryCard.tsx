import type { TimeEntry, WeekStatus } from '../../api/types';
import { longDate } from '../../utils/dates';
import { formatHours } from '../../utils/hours';
import { ExpandableText } from './ExpandableText';
import { TimesheetStatusBadge } from './TimesheetStatusBadge';

interface Props {
  entry: TimeEntry;
  status: WeekStatus;
  /** Provided only while the week is editable. */
  onEdit?: (entry: TimeEntry) => void;
  onDelete?: (entry: TimeEntry) => void;
}

export function TimeEntryCard({ entry, status, onEdit, onDelete }: Props) {
  const context = `${entry.project.code} on ${longDate(entry.work_date)}`;
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
        {onEdit || onDelete ? (
          <div className="entry-actions">
            {onEdit ? (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                aria-label={`Edit entry: ${context}`}
                onClick={() => onEdit(entry)}
              >
                Edit
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                aria-label={`Delete entry: ${context}`}
                onClick={() => onDelete(entry)}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
