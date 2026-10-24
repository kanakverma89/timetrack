import { describe, expect, it } from 'vitest';
import { entry } from '../../test/fixtures';
import { describeSubmitErrors } from './submitErrors';

const entries = [entry({ id: 'abc', work_date: '2026-10-19' })];

describe('describeSubmitErrors', () => {
  it('names the entry, the day, or the week the message is about', () => {
    expect(
      describeSubmitErrors(
        {
          'entries.abc.hours': 'Hours cannot exceed 6 per entry.',
          'day.2026-10-20': 'Total for this day is 17.00 h, above the daily limit of 16.00 h.',
          week: 'Total for the week is 37.00 h, above the weekly limit of 30.00 h.',
          entries: 'Add at least one time entry before submitting.',
        },
        entries,
      ),
    ).toEqual([
      'PRJ-001 on Monday, October 19: Hours cannot exceed 6 per entry.',
      'Tuesday, October 20: Total for this day is 17.00 h, above the daily limit of 16.00 h.',
      'Total for the week is 37.00 h, above the weekly limit of 30.00 h.',
      'Add at least one time entry before submitting.',
    ]);
  });

  it('falls back to the plain message for an entry the page does not know', () => {
    expect(describeSubmitErrors({ 'entries.zzz.hours': 'Too many hours.' }, entries)).toEqual([
      'Too many hours.',
    ]);
  });
});
