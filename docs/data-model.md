# Data model

Source of truth: `backend/app/models/` and migration `backend/alembic/versions/0001_initial_schema.py`
(`alembic check` confirms they match; revisions `0001` initial schema, `0002` time-entry audit events). All primary keys are UUIDs (`gen_random_uuid()` default);
audit timestamps are `timestamptz`.

| Table | Purpose | Notable constraints |
| --- | --- | --- |
| `users` | Accounts | unique lowercase `email` (CHECK), `role` ∈ EMPLOYEE/MANAGER/ADMIN (CHECK), nullable `manager_id` (cannot be self), `password_hash` nullable (reserved for external identity) |
| `auth_sessions` | Server-side login sessions | unique `token_digest` (HMAC of the cookie token), `expires_at`, `revoked_at`; cascades with the user |
| `teams`, `team_memberships` | Team structure (used by Phase 6) | membership PK `(team_id, user_id)` |
| `projects` | Billable/organisational projects | unique `code`, `is_active` (soft-deactivate) |
| `project_tasks` | Tasks per project | unique `(project_id, code)`; unique `(project_id, id)` is the target of a composite FK |
| `earning_codes` | Hour types | unique `code`, `classification` ∈ CAPPED/NON_CAPPED (CHECK) |
| `timesheet_weeks` | One row per employee per week | unique `(employee_id, week_start_date)`; CHECK `week_end_date = week_start_date + 6`; `status` ∈ DRAFT/SUBMITTED/APPROVED/REJECTED; unique `(id, employee_id)` is the target of a composite FK |
| `time_entries` | Hours | `hours NUMERIC(5,2)` CHECK `0 < hours ≤ 24`; description CHECK non-blank and ≤ 256; composite FK `(timesheet_week_id, employee_id)` → week (owner must match); composite FK `(project_id, task_id)` → task (task must belong to the project; skipped when `task_id` is NULL); `version` for optimistic concurrency |
| `time_entry_events` | Append-only audit of entry CREATED/UPDATED/DELETED | `details` JSONB holds ids, date, hours and changed fields only (never the description); `time_entry_id` is deliberately not a foreign key; FKs to week/actor are `RESTRICT` |
| `approval_events` | Append-only audit of SUBMITTED/APPROVED/REJECTED/WITHDRAWN | FKs are `RESTRICT`; no update/delete paths exist |
| `notification_outbox` | Pending notifications | JSONB `payload`, `status` PENDING/PROCESSING/SENT/FAILED |

Indexes follow spec §7.11: `timesheet_weeks(employee_id, week_start_date)`,
`timesheet_weeks(status, week_start_date)`, `time_entries(timesheet_week_id, work_date)`,
`time_entries(employee_id, work_date)`, `project_tasks(project_id, is_active)`,
`approval_events(timesheet_week_id, created_at)`.

Enums are stored as `VARCHAR(20)` with named CHECK constraints (no native PG enum types), which
keeps migrations simple.

**Not enforced by the database** (enforced in `services/time_entry_service.py`): `work_date` lies
inside its week (an entry's date can only change within its week), the week start matches the
configured week-start day, and the configurable per-entry maximum below 24.
