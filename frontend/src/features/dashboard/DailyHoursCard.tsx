import { formatHours, isZeroHours } from '../../utils/hours';
import { monthDay, weekdayShort } from '../../utils/dates';

interface Props {
  date: string;
  hours: string;
  isToday: boolean;
}

export function DailyHoursCard({ date, hours, isToday }: Props) {
  const empty = isZeroHours(hours);
  return (
    <li
      className={`day-card${empty ? '' : ' has-hours'}${isToday ? ' is-today' : ''}`}
      data-testid="day-card"
    >
      <span className="day-name">{weekdayShort(date)}</span>
      <time className="day-date" dateTime={date}>
        {monthDay(date)}
      </time>
      <span className="day-hours">
        <span className="sr-only">Hours logged: </span>
        {formatHours(hours)} <abbr title="hours">h</abbr>
      </span>
      {isToday ? <span className="today-tag">Today</span> : null}
    </li>
  );
}
