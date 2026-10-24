// Mirrors backend/app/schemas. Hours are decimal strings; dates are YYYY-MM-DD.

export type Role = 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
export type WeekStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type Classification = 'CAPPED' | 'NON_CAPPED';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  /** True after an administrator issued a temporary password: nothing else works until changed. */
  must_change_password: boolean;
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
  reviewed_by_name: string | null;
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

export interface BatchResult {
  entries: TimeEntry[];
  summary: WeekSummary;
  daily_totals: DailyTotal[];
}

export interface PersonRef {
  id: string;
  display_name: string;
  email: string;
}

export interface ApprovalListItem {
  week_id: string;
  employee: PersonRef;
  week_start_date: string;
  week_end_date: string;
  status: WeekStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  total_hours: string;
  entry_count: number;
}

export interface ApprovalList {
  items: ApprovalListItem[];
  page: number;
  page_size: number;
  total: number;
}

export type ApprovalAction = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export interface HistoryItem {
  action: ApprovalAction;
  actor: PersonRef;
  comment: string | null;
  created_at: string;
}

export interface ApprovalDetail {
  employee: PersonRef;
  week: TimesheetWeek;
  history: HistoryItem[];
}

// ---- administration --------------------------------------------------------------------

export interface PersonRef {
  id: string;
  display_name: string;
  email: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  manager: PersonRef | null;
  report_count: number;
  must_change_password: boolean;
  created_at: string;
}

export interface UserWithTemporaryPassword {
  user: AdminUser;
  temporary_password: string;
}

export interface UserCreateInput {
  email: string;
  display_name: string;
  role: Role;
  manager_id: string | null;
}

export type UserUpdateInput = Partial<{
  display_name: string;
  role: Role;
  manager_id: string | null;
  is_active: boolean;
}>;

export interface Team {
  id: string;
  name: string;
  member_count: number;
}

export interface TeamDetail extends Team {
  members: PersonRef[];
}

export interface AdminProject {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  task_count: number;
}

export interface AdminTask {
  id: string;
  project_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface AdminEarningCode {
  id: string;
  code: string;
  name: string;
  classification: Classification;
  is_active: boolean;
  entry_count: number;
}

export interface Policy {
  max_hours_per_entry: string;
  max_hours_per_day: string | null;
  max_hours_per_week: string | null;
  description_max_length: number;
  /** "database" when an administrator has overridden the environment defaults. */
  source: string;
  updated_at: string | null;
  updated_by_name: string | null;
  environment_defaults: Record<string, unknown>;
}

export type PolicyInput = Omit<
  Policy,
  'source' | 'updated_at' | 'updated_by_name' | 'environment_defaults'
>;

export type ConfigEntity = 'USER' | 'TEAM' | 'PROJECT' | 'TASK' | 'EARNING_CODE' | 'POLICY';
export type ConfigAction =
  | 'CREATED'
  | 'UPDATED'
  | 'DEACTIVATED'
  | 'REACTIVATED'
  | 'DELETED'
  | 'PASSWORD_RESET'
  | 'MEMBERS_CHANGED';

export interface AuditItem {
  id: string;
  created_at: string;
  actor: PersonRef;
  entity_type: ConfigEntity;
  entity_id: string | null;
  entity_label: string | null;
  action: ConfigAction;
  details: { label?: string; changes?: Record<string, unknown> } & Record<string, unknown>;
}

// ---- reports ---------------------------------------------------------------------------

export type GroupBy = 'employee' | 'project' | 'earning_code' | 'week';

export interface ReportRow {
  key: string;
  label: string;
  detail: string | null;
  total_hours: string;
  capped_hours: string;
  non_capped_hours: string;
  entry_count: number;
  employee_count: number;
}

export interface ReportTotals {
  total_hours: string;
  capped_hours: string;
  non_capped_hours: string;
  entry_count: number;
  employee_count: number;
}

export interface HoursReport extends Paged<ReportRow> {
  group_by: GroupBy;
  date_from: string;
  date_to: string;
  statuses: WeekStatus[];
  totals: ReportTotals;
}
