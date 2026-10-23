import type { Meta, TimeEntry, TimesheetWeek, User } from '../api/types';
import { addDays } from '../utils/dates';

export const USER: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'employee@example.test',
  display_name: 'Alex Employee',
  role: 'EMPLOYEE',
};

export const META: Meta = {
  app_name: 'TimeTrack',
  business_timezone: 'Asia/Kolkata',
  week_start_day: 'MONDAY',
  today: '2026-10-23',
  current_week_start_date: '2026-10-19',
  max_hours_per_entry: '24',
  description_max_length: 256,
};

export function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e1',
    work_date: '2026-10-19',
    hours: '8.00',
    description: 'Sprint planning and implementation',
    project: { id: 'p1', code: 'PRJ-001', name: 'Platform Development' },
    task: { id: 't1', code: 'DEV', name: 'Development' },
    earning_code: { id: 'c1', code: 'REG', name: 'Regular Work', classification: 'CAPPED' },
    ...overrides,
  };
}

export function week(start = '2026-10-19', overrides: Partial<TimesheetWeek> = {}): TimesheetWeek {
  return {
    id: null,
    week_start_date: start,
    week_end_date: addDays(start, 6),
    status: 'DRAFT',
    submitted_at: null,
    reviewed_at: null,
    review_comment: null,
    is_editable: true,
    summary: {
      total_hours: '0.00',
      capped_hours: '0.00',
      non_capped_hours: '0.00',
      entry_count: 0,
      draft_count: 0,
    },
    daily_totals: Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), hours: '0.00' })),
    entries: [],
    ...overrides,
  };
}

/** A populated week: Mon 8.00 + Tue 2.50 (non-capped). */
export function populatedWeek(start = '2026-10-19'): TimesheetWeek {
  const base = week(start);
  return {
    ...base,
    id: 'w1',
    summary: {
      total_hours: '10.50',
      capped_hours: '8.00',
      non_capped_hours: '2.50',
      entry_count: 2,
      draft_count: 2,
    },
    daily_totals: base.daily_totals.map((d, i) =>
      i === 0 ? { ...d, hours: '8.00' } : i === 1 ? { ...d, hours: '2.50' } : d,
    ),
    entries: [
      entry({ id: 'e1', work_date: start }),
      entry({
        id: 'e2',
        work_date: addDays(start, 1),
        hours: '2.50',
        description: 'Production support',
        task: null,
        earning_code: { id: 'c2', code: 'OVT', name: 'Overtime', classification: 'NON_CAPPED' },
      }),
    ],
  };
}
