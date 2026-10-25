import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchMeta, fetchWeek } from '../../api/endpoints';
import { ErrorState } from '../../components/ErrorState';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Toast } from '../../components/Toast';
import type { TimeEntry, TimesheetWeek } from '../../api/types';
import { DeleteEntryDialog } from '../time-entries/DeleteEntryDialog';
import { SubmitWeekDialog } from './SubmitWeekDialog';
import { WithdrawWeekDialog } from './WithdrawWeekDialog';
import { TimeEntryFormPanel } from '../time-entries/TimeEntryFormPanel';
import { addDays, formatTimestamp, formatWeekRange, isValidIsoDate } from '../../utils/dates';
import { formatHours } from '../../utils/hours';
import { DailyHoursCard } from './DailyHoursCard';
import { TimeEntryList } from './TimeEntryList';
import { WeekNavigator } from './WeekNavigator';
import { WeeklySummary } from './WeeklySummary';

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('week');
  const requestedIsValid = isValidIsoDate(requested);

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta, staleTime: 5 * 60_000 });
  const weekStart = requestedIsValid ? requested : (meta.data?.current_week_start_date ?? null);

  const week = useQuery({
    queryKey: ['week', weekStart],
    queryFn: ({ signal }) => fetchWeek(weekStart as string, signal),
    enabled: weekStart !== null,
  });

  // Keep the URL canonical: the server normalises any date to its week start.
  const canonicalStart = week.data?.week_start_date;
  useEffect(() => {
    if (requested !== null && canonicalStart && requested !== canonicalStart) {
      setParams({ week: canonicalStart }, { replace: true });
    }
  }, [requested, canonicalStart, setParams]);

  useEffect(() => {
    document.title = 'Timesheet · TimeTrack';
  }, []);

  const [panel, setPanel] = useState<{ entry: TimeEntry | null } | null>(null);
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [toast, setToast] = useState('');
  const dismissToast = useCallback(() => setToast(''), []);

  const goTo = (start: string) => setParams({ week: start });
  const base = weekStart;

  let announcement = '';
  if (week.data) {
    announcement = `Showing ${formatWeekRange(week.data.week_start_date, week.data.week_end_date)}. Total ${formatHours(
      week.data.summary.total_hours,
    )} hours in ${week.data.summary.entry_count} entries. Status ${week.data.status.toLowerCase()}.`;
  }

  const isCurrentWeek =
    meta.data !== undefined && week.data?.week_start_date === meta.data.current_week_start_date;

  let body;
  if (meta.isError && !requestedIsValid) {
    body = (
      <ErrorState
        error={meta.error}
        title="We could not determine the current week"
        onRetry={() => void meta.refetch()}
      />
    );
  } else if (week.isError && !week.data) {
    // A failed background refresh keeps the data already on screen; only a first load is fatal.
    body = <ErrorState error={week.error} onRetry={() => void week.refetch()} />;
  } else if (!week.data) {
    body = <LoadingSkeleton label="Loading timesheet" />;
  } else {
    const data = week.data;
    body = (
      <>
        {data.status === 'REJECTED' ? (
          <div className="banner banner-warning" role="status">
            <strong>This week was rejected.</strong>{' '}
            {data.review_comment ? <>Reason: {data.review_comment} </> : null}
            {decisionLine(data, meta.data?.business_timezone)}
          </div>
        ) : null}
        {!data.is_editable ? (
          <div className="banner banner-info" role="status">
            This week is {data.status.toLowerCase()} and read-only.
            {data.submitted_at
              ? ` Submitted ${formatTimestamp(data.submitted_at, meta.data?.business_timezone ?? 'UTC')}.`
              : ''}
            {data.status === 'APPROVED' ? (
              <> {decisionLine(data, meta.data?.business_timezone)}</>
            ) : null}
            {data.status === 'APPROVED' && data.review_comment ? (
              <> Comment: {data.review_comment}</>
            ) : null}
          </div>
        ) : null}
        <ul className="day-grid" aria-label="Hours by day">
          {data.daily_totals.map((day) => (
            <DailyHoursCard
              key={day.date}
              date={day.date}
              hours={day.hours}
              isToday={meta.data?.today === day.date}
            />
          ))}
        </ul>
        <WeeklySummary
          week={data}
          actions={
            data.is_editable ? (
              <div key="submit" className="submit-action">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={data.summary.entry_count === 0}
                  aria-describedby={data.summary.entry_count === 0 ? 'submit-hint' : undefined}
                  onClick={() => setSubmitting(true)}
                >
                  {data.status === 'REJECTED' ? 'Resubmit week' : 'Submit week'}
                </button>
                {data.summary.entry_count === 0 ? (
                  <p id="submit-hint" className="hint">
                    Add at least one entry to submit.
                  </p>
                ) : null}
              </div>
            ) : data.status === 'SUBMITTED' ? (
              // A distinct key makes React replace the Submit button instead of restyling it, so its
              // colour transition never plays from green to white (axe measured the half-way colour).
              <div key="withdraw" className="submit-action">
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-describedby="withdraw-hint"
                  onClick={() => setWithdrawing(true)}
                >
                  Withdraw submission
                </button>
                <p id="withdraw-hint" className="hint">
                  Waiting for your manager. Withdraw it to make changes.
                </p>
              </div>
            ) : null
          }
        />
        <TimeEntryList
          entries={data.entries}
          dailyTotals={data.daily_totals}
          status={data.status}
          onEdit={data.is_editable ? (entry) => setPanel({ entry }) : undefined}
          onDelete={data.is_editable ? setDeleting : undefined}
        />
      </>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-head">
        <h1>Timesheet</h1>
        {week.data?.is_editable ? (
          <button
            type="button"
            className="btn btn-primary"
            data-focus-fallback
            onClick={() => setPanel({ entry: null })}
          >
            Add entry
          </button>
        ) : null}
      </div>
      <WeekNavigator
        start={week.data?.week_start_date ?? null}
        end={week.data?.week_end_date ?? null}
        isCurrentWeek={isCurrentWeek}
        onPrevious={() => base && goTo(addDays(base, -7))}
        onNext={() => base && goTo(addDays(base, 7))}
        onCurrent={() => setParams({})}
      />
      <LiveRegion message={announcement} />
      {body}

      {panel && week.data ? (
        <TimeEntryFormPanel
          week={week.data}
          entry={panel.entry}
          defaultDate={defaultDate(
            week.data.week_start_date,
            week.data.week_end_date,
            meta.data?.today,
          )}
          maxHours={meta.data?.max_hours_per_entry ?? '24'}
          descriptionMax={meta.data?.description_max_length ?? 256}
          onClose={() => setPanel(null)}
          onSaved={(message) => {
            setPanel(null);
            setToast(message);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteEntryDialog
          entry={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            setToast('Entry deleted.');
          }}
        />
      ) : null}
      {submitting && week.data ? (
        <SubmitWeekDialog
          week={week.data}
          onCancel={() => setSubmitting(false)}
          onSubmitted={() => {
            setSubmitting(false);
            setToast('Week submitted for approval.');
          }}
        />
      ) : null}
      {withdrawing && week.data ? (
        <WithdrawWeekDialog
          week={week.data}
          onCancel={() => setWithdrawing(false)}
          onWithdrawn={() => {
            setWithdrawing(false);
            setToast('Submission withdrawn. This week is a draft again and can be edited.');
          }}
        />
      ) : null}
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

/** Today if it falls inside the week, otherwise the first day of the week. */
function defaultDate(start: string, end: string, today: string | undefined): string {
  return today && today >= start && today <= end ? today : start;
}

/** "Reviewed by Morgan Manager, Oct 24, 2026, 3:41 PM." (empty until a decision exists). */
function decisionLine(week: TimesheetWeek, timeZone = 'UTC'): string {
  if (!week.reviewed_by_name || !week.reviewed_at) return '';
  return `Reviewed by ${week.reviewed_by_name}, ${formatTimestamp(week.reviewed_at, timeZone)}.`;
}
