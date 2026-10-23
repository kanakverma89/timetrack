// Mirrors backend/app/schemas. Hours are decimal strings; dates are YYYY-MM-DD.

export type Role = 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
export type WeekStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type Classification = 'CAPPED' | 'NON_CAPPED';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
}

export interface Meta {
  app_name: string;
  business_timezone: string;
  week_start_day: string;
  today: string;
  current_week_start_date: string;
  max_hours_per_entry: string;
  description_max_length: number;
}

export interface ProjectRef {
  id: string;
  code: string;
  name: string;
}

export interface EarningCodeRef extends ProjectRef {
  classification: Classification;
}

export interface TimeEntry {
  id: string;
  work_date: string;
  hours: string;
  description: string;
  version: number;
  project: ProjectRef;
  task: ProjectRef | null;
  earning_code: EarningCodeRef;
}

export interface WeekSummary {
  total_hours: string;
  capped_hours: string;
  non_capped_hours: string;
  entry_count: number;
  draft_count: number;
}

export interface DailyTotal {
  date: string;
  hours: string;
}

export interface TimesheetWeek {
  id: string | null;
  week_start_date: string;
  week_end_date: string;
  status: WeekStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  is_editable: boolean;
  summary: WeekSummary;
  daily_totals: DailyTotal[];
  entries: TimeEntry[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    field_errors: Record<string, string>;
    request_id: string;
  };
}

export interface ProjectOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface TaskOption {
  id: string;
  project_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface EarningCodeOption {
  id: string;
  code: string;
  name: string;
  classification: Classification;
  is_active: boolean;
}

/** Body of POST /time-entries. The employee is never sent; the server uses the session. */
export interface EntryInput {
  work_date: string;
  hours: string;
  earning_code_id: string;
  project_id: string;
  task_id: string | null;
  description: string;
}
