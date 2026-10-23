import { formatWeekRange } from '../../utils/dates';

interface Props {
  start: string | null;
  end: string | null;
  isCurrentWeek: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCurrent: () => void;
}

export function WeekNavigator({ start, end, isCurrentWeek, onPrevious, onNext, onCurrent }: Props) {
  const label = start && end ? formatWeekRange(start, end) : 'Loading week…';
  return (
    <nav className="week-nav" aria-label="Week navigation">
      <button type="button" className="btn btn-secondary" onClick={onPrevious}>
        <span aria-hidden="true">‹</span> Previous week
      </button>
      <h2 className="week-label" data-testid="week-range">
        {label}
      </h2>
      <button type="button" className="btn btn-secondary" onClick={onNext}>
        Next week <span aria-hidden="true">›</span>
      </button>
      <button type="button" className="btn btn-link" onClick={onCurrent} disabled={isCurrentWeek}>
        Current week
      </button>
    </nav>
  );
}
