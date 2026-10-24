import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  defaultWeekDays,
  isDirty,
  isWeekDirty,
  sumHours,
  validateEntry,
  validateWeek,
  type EntryFormValues,
} from './validation';

const ctx = {
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  maxHours: '24.00',
  descriptionMax: 256,
  projectHasTasks: true,
};

const valid: EntryFormValues = {
  work_date: '2026-10-21',
  hours: '7.5',
  earning_code_id: 'c1',
  project_id: 'p1',
  task_id: 't1',
  description: 'Work',
};

const errorsFor = (overrides: Partial<EntryFormValues>, c = ctx) =>
  validateEntry({ ...valid, ...overrides }, c);

describe('validateEntry', () => {
  it('accepts a complete entry', () => {
    expect(errorsFor({})).toEqual({});
  });

  it('requires every field', () => {
    const errors = validateEntry(
      {
        work_date: '',
        hours: '',
        earning_code_id: '',
        project_id: '',
        task_id: '',
        description: '',
      },
      ctx,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ['description', 'earning_code_id', 'hours', 'project_id', 'work_date'].sort(),
    );
  });

  it.each([
    ['0', 'Hours must be greater than zero.'],
    ['0.00', 'Hours must be greater than zero.'],
    ['-1', 'Hours must be greater than zero.'],
    ['24.01', 'Hours cannot exceed 24 per entry.'],
    ['8.555', 'Hours can have at most two decimal places.'],
    ['abc', 'Enter hours as a number, for example 7.5.'],
    ['1e3', 'Enter hours as a number, for example 7.5.'],
    ['8,5', 'Enter hours as a number, for example 7.5.'],
    ['', 'Hours are required.'],
    ['  ', 'Hours are required.'],
  ])('rejects hours %j', (hours, message) => {
    expect(errorsFor({ hours }).hours).toBe(message);
  });

  it.each(['0.01', '1', '7.5', '8.25', '24', '24.00', ' 8 '])('accepts hours %j', (hours) => {
    expect(errorsFor({ hours }).hours).toBeUndefined();
  });

  it('compares decimals exactly, without floating point', () => {
    expect(compareDecimal('0.10', '0.1')).toBe(0);
    expect(compareDecimal('24.00', '24')).toBe(0);
    expect(compareDecimal('24.01', '24')).toBe(1);
    expect(compareDecimal('7.9', '7.10')).toBe(1);
    expect(compareDecimal('0', '0.00')).toBe(0);
    expect(compareDecimal('0.29', '0.3')).toBe(-1);
  });

  it('keeps the date inside the selected week', () => {
    expect(errorsFor({ work_date: '2026-10-19' }).work_date).toBeUndefined();
    expect(errorsFor({ work_date: '2026-10-25' }).work_date).toBeUndefined();
    expect(errorsFor({ work_date: '2026-10-18' }).work_date).toMatch(/within this week/);
    expect(errorsFor({ work_date: '2026-10-26' }).work_date).toMatch(/within this week/);
    expect(errorsFor({ work_date: '2026-02-30' }).work_date).toBe('Enter a valid date.');
  });

  it('requires a task only when the project has tasks', () => {
    expect(errorsFor({ task_id: '' }).task_id).toBe('Select a task for this project.');
    expect(errorsFor({ task_id: '' }, { ...ctx, projectHasTasks: false }).task_id).toBeUndefined();
    // No project yet: only the project is reported, not a task.
    const none = errorsFor({ project_id: '', task_id: '' });
    expect(none.project_id).toBe('Select a project.');
    expect(none.task_id).toBeUndefined();
  });

  it('enforces the description length on trimmed text', () => {
    expect(errorsFor({ description: '   ' }).description).toBe('Description is required.');
    expect(errorsFor({ description: 'x'.repeat(256) }).description).toBeUndefined();
    expect(errorsFor({ description: 'x'.repeat(257) }).description).toMatch(/256 characters/);
    expect(errorsFor({ description: `  ${'x'.repeat(256)}  ` }).description).toBeUndefined();
  });
});

describe('isDirty', () => {
  it('detects any changed field', () => {
    expect(isDirty(valid, { ...valid })).toBe(false);
    expect(isDirty({ ...valid, hours: '8' }, valid)).toBe(true);
    expect(isDirty({ ...valid, description: 'Work ' }, valid)).toBe(true);
  });
});

describe('sumHours', () => {
  it('adds decimal strings exactly (integer cents, no floating point)', () => {
    expect(sumHours(['0.1', '0.2'])).toBe('0.30');
    expect(sumHours(['8', '7.5', '0.25'])).toBe('15.75');
    expect(sumHours(['24', '24', '24', '24', '24', '24', '24'])).toBe('168.00');
    expect(sumHours(Array.from({ length: 1000 }, () => '0.01'))).toBe('10.00');
  });
  it('ignores blanks and values that are not valid hours', () => {
    expect(sumHours(['', '  ', 'abc', '-3', '1e2', '1.234', '2'])).toBe('2.00');
    expect(sumHours([])).toBe('0.00');
  });
});

describe('defaultWeekDays', () => {
  it('lists the seven dates and leaves Saturday and Sunday unchecked', () => {
    const days = defaultWeekDays('2026-10-19');
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(days.map((d) => d.enabled)).toEqual([true, true, true, true, true, false, false]);
    expect(days.every((d) => d.hours === '')).toBe(true);
  });
  it('works across a year boundary and for a Sunday-first week', () => {
    expect(defaultWeekDays('2025-12-29')[3]?.date).toBe('2026-01-01');
    const sundayFirst = defaultWeekDays('2026-10-18');
    expect(sundayFirst.map((d) => d.enabled)).toEqual([false, true, true, true, true, true, false]);
  });
});

describe('validateWeek', () => {
  const days = (hours: Array<string | null>) =>
    defaultWeekDays('2026-10-19').map((d, i) => ({
      ...d,
      enabled: hours[i] !== null && hours[i] !== undefined,
      hours: hours[i] ?? '',
    }));

  it('collects only enabled days with positive hours, in date order', () => {
    const result = validateWeek(valid, days(['8', '7.5', null, '0', '', null, null]), ctx);
    expect(result.entries).toEqual([
      { date: '2026-10-19', hours: '8' },
      { date: '2026-10-20', hours: '7.5' },
    ]);
    expect(result.days).toEqual({});
    expect(result.form).toBeNull();
    expect(result.fields).toEqual({});
  });

  it('ignores hours typed into a day that is switched off', () => {
    const list = days(['8', null, null, null, null, null, null]);
    list[1] = { ...list[1]!, enabled: false, hours: '99' };
    expect(validateWeek(valid, list, ctx).entries).toHaveLength(1);
    expect(validateWeek(valid, list, ctx).days).toEqual({});
  });

  it('requires at least one day with positive hours', () => {
    for (const list of [days([]), days(['', '', '', '', '', null, null]), days(['0', '0.00'])]) {
      const result = validateWeek(valid, list, ctx);
      expect(result.form).toBe('Enter hours for at least one day.');
      expect(result.entries).toEqual([]);
    }
  });

  it('reports invalid days individually and does not also show the "at least one" message', () => {
    const result = validateWeek(valid, days(['abc', '25', '8', '7.555', '-1']), ctx);
    expect(result.days).toEqual({
      '2026-10-19': 'Enter hours as a number, for example 7.5.',
      '2026-10-20': 'Hours cannot exceed 24 per entry.',
      '2026-10-22': 'Hours can have at most two decimal places.',
      '2026-10-23': 'Hours must be greater than zero.',
    });
    expect(result.form).toBeNull();
    expect(result.entries).toEqual([{ date: '2026-10-21', hours: '8' }]);
  });

  it('validates the shared fields too', () => {
    const result = validateWeek(
      { ...valid, project_id: '', earning_code_id: '', description: ' ' },
      days(['8']),
      ctx,
    );
    expect(Object.keys(result.fields).sort()).toEqual([
      'description',
      'earning_code_id',
      'project_id',
    ]);
  });
});

describe('isWeekDirty', () => {
  it('notices toggles and typed hours', () => {
    const base = defaultWeekDays('2026-10-19');
    expect(isWeekDirty(base, base)).toBe(false);
    expect(
      isWeekDirty(
        base.map((d, i) => (i === 0 ? { ...d, hours: '1' } : d)),
        base,
      ),
    ).toBe(true);
    expect(
      isWeekDirty(
        base.map((d, i) => (i === 5 ? { ...d, enabled: true } : d)),
        base,
      ),
    ).toBe(true);
  });
});
