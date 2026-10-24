import { FieldError } from '../../components/FieldError';
import { longDate, monthDay, weekdayShort } from '../../utils/dates';
import { formatHours, isZeroHours } from '../../utils/hours';
import { sumHours, type WeekDay } from './validation';

interface Props {
  idPrefix: string;
  days: WeekDay[];
  /** Hours already recorded per date, shown so the user does not double-book by accident. */
  existing: Record<string, string>;
  errors: Record<string, string>;
  maxHours: string;
  onChange: (date: string, patch: Partial<Pick<WeekDay, 'enabled' | 'hours'>>) => void;
}

export const weekHoursInputId = (prefix: string, date: string) => `${prefix}-hours-${date}`;

export function WeekHoursGrid({ idPrefix, days, existing, errors, maxHours, onChange }: Props) {
  const total = sumHours(days.filter((d) => d.enabled).map((d) => d.hours));
  return (
    <fieldset className="week-grid">
      <legend>
        Hours per day <span className="required">(enter hours for at least one day)</span>
      </legend>
      <p className="hint">
        Untick a day to leave it out. A day left blank or at 0 records nothing. Maximum{' '}
        {maxHours.replace(/\.0+$/, '')} per day.
      </p>
      <ul className="week-days">
        {days.map((day) => {
          const inputId = weekHoursInputId(idPrefix, day.date);
          const errorId = `${inputId}-error`;
          const logged = existing[day.date];
          const hintId = `${inputId}-hint`;
          const hasExisting = logged !== undefined && !isZeroHours(logged);
          return (
            <li key={day.date} className={`week-day${day.enabled ? '' : ' is-off'}`}>
              <label className="week-day-toggle">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => onChange(day.date, { enabled: e.target.checked })}
                />
                <span>
                  <strong>{weekdayShort(day.date)}</strong> {monthDay(day.date)}
                </span>
              </label>
              <div className="week-day-input">
                <input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Hours for ${longDate(day.date)}`}
                  value={day.hours}
                  disabled={!day.enabled}
                  aria-invalid={errors[day.date] ? 'true' : undefined}
                  aria-describedby={
                    [errors[day.date] ? errorId : null, hasExisting ? hintId : null]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onChange={(e) => onChange(day.date, { hours: e.target.value })}
                />
                {hasExisting ? (
                  <span id={hintId} className="hint">
                    Already logged: {formatHours(logged)} h
                  </span>
                ) : null}
              </div>
              <FieldError id={errorId} message={errors[day.date]} />
            </li>
          );
        })}
      </ul>
      <p className="week-total" role="status" aria-live="polite" aria-atomic="true">
        Total: <strong data-testid="week-total">{total}</strong> hours
      </p>
    </fieldset>
  );
}
