import { describe, expect, it } from 'vitest';
import { compareDecimal, isDirty, validateEntry, type EntryFormValues } from './validation';

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
