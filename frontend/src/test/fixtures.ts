import type {
  ApprovalDetail,
  ApprovalListItem,
  Meta,
  TimeEntry,
  TimesheetWeek,
  User,
} from '../api/types';
import { addDays } from '../utils/dates';

export const USER: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'employee@example.test',
  display_name: 'Alex Employee',
  role: 'EMPLOYEE',
  must_change_password: false,
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
    version: 1,
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
    reviewed_by_name: null,
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

/** Build a week payload from entries, summing in integer cents (test-only helper). */
export function weekFromEntries(start: string, entries: TimeEntry[]): TimesheetWeek {
  const cents = (hours: string) => Math.round(Number(hours) * 100);
  const fmt = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
  const base = week(start);
  const sum = (items: TimeEntry[]) => items.reduce((acc, e) => acc + cents(e.hours), 0);
  return {
    ...base,
    id: entries.length ? 'w1' : null,
    summary: {
      total_hours: fmt(sum(entries)),
      capped_hours: fmt(sum(entries.filter((e) => e.earning_code.classification === 'CAPPED'))),
      non_capped_hours: fmt(
        sum(entries.filter((e) => e.earning_code.classification === 'NON_CAPPED')),
      ),
      entry_count: entries.length,
      draft_count: entries.length,
    },
    daily_totals: base.daily_totals.map((d) => ({
      date: d.date,
      hours: fmt(sum(entries.filter((e) => e.work_date === d.date))),
    })),
    entries,
  };
}

export const PROJECTS = [
  { id: 'p1', code: 'PRJ-001', name: 'Platform Development', is_active: true },
  { id: 'p2', code: 'PRJ-003', name: 'Internal Operations', is_active: true },
];
export const TASKS_P1 = [
  { id: 't1', project_id: 'p1', code: 'DEV', name: 'Development', is_active: true },
  { id: 't2', project_id: 'p1', code: 'REV', name: 'Code Review', is_active: true },
];
export const EARNING_CODES = [
  { id: 'c1', code: 'REG', name: 'Regular Work', classification: 'CAPPED', is_active: true },
  { id: 'c2', code: 'OVT', name: 'Overtime', classification: 'NON_CAPPED', is_active: true },
] as const;

export const MANAGER: User = {
  id: '00000000-0000-4000-8000-0000000000aa',
  email: 'manager@example.test',
  display_name: 'Morgan Manager',
  role: 'MANAGER',
  must_change_password: false,
};

export const ALEX = { id: 'u-alex', display_name: 'Alex Employee', email: 'employee@example.test' };

export function approvalItem(overrides: Partial<ApprovalListItem> = {}): ApprovalListItem {
  return {
    week_id: 'w-1',
    employee: ALEX,
    week_start_date: '2026-10-19',
    week_end_date: '2026-10-25',
    status: 'SUBMITTED',
    submitted_at: '2026-10-24T10:11:00Z',
    reviewed_at: null,
    reviewer_name: null,
    total_hours: '10.50',
    entry_count: 2,
    ...overrides,
  };
}

export function approvalDetail(overrides: Partial<ApprovalDetail> = {}): ApprovalDetail {
  const base = populatedWeek('2026-10-19');
  return {
    employee: ALEX,
    week: { ...base, id: 'w-1', status: 'SUBMITTED', is_editable: false },
    history: [
      {
        action: 'SUBMITTED',
        actor: ALEX,
        comment: 'Please review',
        created_at: '2026-10-24T10:11:00Z',
      },
    ],
    ...overrides,
  };
}

export const ADMIN: User = {
  id: '00000000-0000-4000-8000-0000000000ad',
  email: 'admin@example.test',
  display_name: 'Avery Admin',
  role: 'ADMIN',
  must_change_password: false,
};
