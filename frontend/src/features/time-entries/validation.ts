import { formatWeekRange, isValidIsoDate } from '../../utils/dates';

export interface EntryFormValues {
  work_date: string;
  hours: string;
  earning_code_id: string;
  project_id: string;
  task_id: string;
  description: string;
}

export type FieldName = keyof EntryFormValues;
export type FieldErrors = Partial<Record<FieldName, string>>;

export const FIELD_ORDER: FieldName[] = [
  'work_date',
  'hours',
  'earning_code_id',
  'project_id',
  'task_id',
  'description',
];

export interface ValidationContext {
  weekStart: string;
  weekEnd: string;
  maxHours: string;
  descriptionMax: number;
  projectHasTasks: boolean;
}

const DECIMAL = /^\d+(\.\d+)?$/;

function stripZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/** Compare two non-negative decimal strings without floating point. */
export function compareDecimal(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const width = Math.max(af.length, bf.length);
  const left = BigInt(ai + af.padEnd(width, '0'));
  const right = BigInt(bi + bf.padEnd(width, '0'));
  return left === right ? 0 : left < right ? -1 : 1;
}

function hoursError(raw: string, maxHours: string): string | null {
  const hours = raw.trim();
  if (hours === '') return 'Hours are required.';
  if (hours.startsWith('-')) return 'Hours must be greater than zero.';
  if (!DECIMAL.test(hours)) return 'Enter hours as a number, for example 7.5.';
  if ((hours.split('.')[1] ?? '').length > 2) return 'Hours can have at most two decimal places.';
  if (compareDecimal(hours, '0') === 0) return 'Hours must be greater than zero.';
  if (compareDecimal(hours, maxHours) > 0) {
    return `Hours cannot exceed ${stripZeros(maxHours)} per entry.`;
  }
  return null;
}

/** Client-side mirror of the server rules, so obvious mistakes are caught before a round trip. */
export function validateEntry(values: EntryFormValues, ctx: ValidationContext): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.work_date) errors.work_date = 'Date is required.';
  else if (!isValidIsoDate(values.work_date)) errors.work_date = 'Enter a valid date.';
  else if (values.work_date < ctx.weekStart || values.work_date > ctx.weekEnd) {
    errors.work_date = `Date must be within this week (${formatWeekRange(ctx.weekStart, ctx.weekEnd)}).`;
  }

  const hours = hoursError(values.hours, ctx.maxHours);
  if (hours) errors.hours = hours;

  if (!values.earning_code_id) errors.earning_code_id = 'Select an earning code.';
  if (!values.project_id) errors.project_id = 'Select a project.';
  else if (ctx.projectHasTasks && !values.task_id)
    errors.task_id = 'Select a task for this project.';

  const description = values.description.trim();
  if (!description) errors.description = 'Description is required.';
  else if (description.length > ctx.descriptionMax) {
    errors.description = `Description must be ${ctx.descriptionMax} characters or fewer.`;
  }
  return errors;
}

export function isDirty(current: EntryFormValues, initial: EntryFormValues): boolean {
  return FIELD_ORDER.some((field) => current[field] !== initial[field]);
}
