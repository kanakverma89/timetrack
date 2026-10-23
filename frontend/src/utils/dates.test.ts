import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatWeekRange,
  isValidIsoDate,
  longDate,
  monthDay,
  weekdayShort,
} from './dates';

describe('isValidIsoDate', () => {
  it.each(['2026-10-19', '2024-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isValidIsoDate(value)).toBe(true);
  });
  it.each(['2026-02-30', '2026-13-01', '2025-02-29', '20261019', '2026-1-1', '', 'abc'])(
    'rejects %s',
    (value) => {
      expect(isValidIsoDate(value)).toBe(false);
    },
  );
  it('rejects null and undefined', () => {
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
  });
});

describe('addDays', () => {
  it('moves forward and back by a week', () => {
    expect(addDays('2026-10-19', 7)).toBe('2026-10-26');
    expect(addDays('2026-10-19', -7)).toBe('2026-10-12');
  });
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02');
    expect(addDays('2025-12-29', 7)).toBe('2026-01-05');
    expect(addDays('2026-01-05', -7)).toBe('2025-12-29');
  });
  it('handles leap days', () => {
    expect(addDays('2024-02-26', 3)).toBe('2024-02-29');
    expect(addDays('2024-02-26', 4)).toBe('2024-03-01');
    expect(addDays('2023-02-26', 3)).toBe('2023-03-01');
  });
  it('throws on invalid input rather than producing a wrong date', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('formats weekday and month/day independent of the machine timezone', () => {
    expect(weekdayShort('2026-10-19')).toBe('Mon');
    expect(weekdayShort('2026-10-25')).toBe('Sun');
    expect(monthDay('2026-10-19')).toBe('Oct 19');
    expect(longDate('2026-10-19')).toBe('Monday, October 19');
  });
  it('formats a week range within a year', () => {
    expect(formatWeekRange('2026-10-19', '2026-10-25')).toBe('Oct 19 – Oct 25, 2026');
    expect(formatWeekRange('2026-10-26', '2026-11-01')).toBe('Oct 26 – Nov 1, 2026');
  });
  it('shows both years when the week spans New Year', () => {
    expect(formatWeekRange('2025-12-29', '2026-01-04')).toBe('Dec 29, 2025 – Jan 4, 2026');
  });
});
