import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchApproval } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { ErrorState } from '../../components/ErrorState';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Toast } from '../../components/Toast';
import { useMeta } from '../../hooks/useMeta';
import { formatTimestamp, formatWeekRange } from '../../utils/dates';
import { formatHours } from '../../utils/hours';
import { DailyHoursCard } from '../dashboard/DailyHoursCard';
import { TimeEntryList } from '../dashboard/TimeEntryList';
import { TimesheetStatusBadge } from '../dashboard/TimesheetStatusBadge';
import { WeeklySummary } from '../dashboard/WeeklySummary';
import { ApprovalHistory } from './ApprovalHistory';
import { DecisionDialog } from './DecisionDialog';

export function ReviewPage() {
  const { weekId = '' } = useParams();
  const meta = useMeta();
  const timeZone = meta.data?.business_timezone ?? 'UTC';
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [toast, setToast] = useState('');
  const dismissToast = useCallback(() => setToast(''), []);

  const query = useQuery({
    queryKey: ['approval', weekId],
    queryFn: () => fetchApproval(weekId),
    // A 404/403 will not change on retry.
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });

  const back = (
    <p>
      <Link to="/approvals">← Back to approvals</Link>
    </p>
  );

  if (query.isPending) return <LoadingSkeleton label="Loading timesheet" />;
  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    if (status === 404) {
      return (
        <div className="empty-state" role="alert">
          <h1>Timesheet not found</h1>
          <p>It does not exist, or it is not one you are allowed to review.</p>
          {back}
        </div>
      );
    }
    if (status === 403) {
      return (
        <div className="empty-state" role="alert">
          <h1>You cannot review this timesheet</h1>
          <p>Nobody can review their own timesheet.</p>
          {back}
        </div>
      );
    }
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { week, employee, history } = query.data;
  const submission = [...history].reverse().find((item) => item.action === 'SUBMITTED');
  const awaiting = week.status === 'SUBMITTED';

  return (
    <div className="review">
      {back}
      <div className="dashboard-head">
        <h1>
          {employee.display_name}
          <span className="muted">
            {' '}
            · {formatWeekRange(week.week_start_date, week.week_end_date)}
          </span>
        </h1>
        <TimesheetStatusBadge status={week.status} />
      </div>
      <LiveRegion
        message={`Reviewing ${employee.display_name}, ${formatWeekRange(week.week_start_date, week.week_end_date)}. Status ${week.status.toLowerCase()}.`}
      />

      {awaiting ? (
        <div className="decision-bar" role="group" aria-label="Decision">
          <p>
            {submission ? `Submitted ${formatTimestamp(submission.created_at, timeZone)}. ` : ''}
            Total {formatHours(week.summary.total_hours)} hours.
          </p>
          <div className="decision-actions">
            <button type="button" className="btn btn-primary" onClick={() => setDialog('approve')}>
              Approve
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog('reject')}>
              Reject
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`banner ${week.status === 'REJECTED' ? 'banner-warning' : 'banner-info'}`}
          role="status"
        >
          {week.status === 'APPROVED' ? 'This week was approved' : null}
          {week.status === 'REJECTED' ? 'This week was rejected; it is with the employee' : null}
          {week.reviewed_by_name && week.reviewed_at
            ? ` by ${week.reviewed_by_name}, ${formatTimestamp(week.reviewed_at, timeZone)}`
            : ''}
          .
          {week.review_comment ? (
            <>
              {' '}
              {week.status === 'REJECTED' ? 'Reason' : 'Comment'}: {week.review_comment}
            </>
          ) : null}
        </div>
      )}

      {submission?.comment ? (
        <blockquote className="employee-note">
          <strong>Note from {employee.display_name}:</strong> {submission.comment}
        </blockquote>
      ) : null}

      <ul className="day-grid" aria-label="Hours by day">
        {week.daily_totals.map((day) => (
          <DailyHoursCard key={day.date} date={day.date} hours={day.hours} isToday={false} />
        ))}
      </ul>
      <WeeklySummary week={week} />
      <TimeEntryList entries={week.entries} dailyTotals={week.daily_totals} status={week.status} />
      <ApprovalHistory items={history} timeZone={timeZone} />

      {dialog ? (
        <DecisionDialog
          mode={dialog}
          detail={query.data}
          onCancel={() => setDialog(null)}
          onDecided={(mode) => {
            setDialog(null);
            setToast(
              mode === 'approve' ? 'Week approved.' : 'Week rejected and returned to the employee.',
            );
          }}
        />
      ) : null}
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}
