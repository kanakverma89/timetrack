import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchMeta, fetchWeek } from '../../api/endpoints';
import { ErrorState } from '../../components/ErrorState';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { addDays, formatWeekRange, isValidIsoDate } from '../../utils/dates';
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
  } else if (week.isError) {
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
            {data.review_comment ? <>Reason: {data.review_comment}</> : null}
          </div>
        ) : null}
        {!data.is_editable ? (
          <div className="banner banner-info" role="status">
            This week is {data.status.toLowerCase()} and read-only.
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
        <WeeklySummary week={data} />
        <TimeEntryList
          entries={data.entries}
          dailyTotals={data.daily_totals}
          status={data.status}
        />
      </>
    );
  }

  return (
    <div className="dashboard">
      <h1>Timesheet</h1>
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
    </div>
  );
}
