import type { DailyTotal, TimeEntry, WeekStatus } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { longDate } from '../../utils/dates';
import { formatHours } from '../../utils/hours';
import { TimeEntryCard } from './TimeEntryCard';

interface Props {
  entries: TimeEntry[];
  dailyTotals: DailyTotal[];
  status: WeekStatus;
  onEdit?: (entry: TimeEntry) => void;
  onDelete?: (entry: TimeEntry) => void;
}

export function groupByDate(entries: TimeEntry[]): Array<[date: string, entries: TimeEntry[]]> {
  const groups = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.work_date) ?? [];
    list.push(entry);
    groups.set(entry.work_date, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function TimeEntryList({ entries, dailyTotals, status, onEdit, onDelete }: Props) {
  const totals = new Map(dailyTotals.map((t) => [t.date, t.hours]));
  return (
    <section className="entries" aria-labelledby="entries-heading">
      <h2 id="entries-heading">Time entries</h2>
      {entries.length === 0 ? (
        <EmptyState title="No time entries this week">
          Nothing has been recorded for this week yet.
        </EmptyState>
      ) : (
        groupByDate(entries).map(([date, dayEntries]) => (
          <div className="entry-group" key={date} data-testid="entry-group">
            <h3 className="entry-group-title">
              <span>{longDate(date)}</span>
              <span className="muted">{formatHours(totals.get(date) ?? '0.00')} h</span>
            </h3>
            <ul className="entry-list">
              {dayEntries.map((entry) => (
                <TimeEntryCard
                  key={entry.id}
                  entry={entry}
                  status={status}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
