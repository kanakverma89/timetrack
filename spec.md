# Independent Timesheet Management Application

## Product and Technical Specification for Claude Code

**Document type:** Implementation specification\
**Status:** Initial baseline\
**Primary milestone:** Employee Dashboard\
**Target audience:** Claude Code, software engineers, QA engineers\
**Product name:** Working title --- `TimeTrack` (configurable; do not
use any company-specific branding)

------------------------------------------------------------------------

## 1. Instructions to Claude Code

You are implementing a new, independent Timesheet Management Application
from this specification and the user-provided reference
screenshots/sequence diagrams.

### Mandatory working rules

1.  **Inspect before changing.** If a repository already exists, inspect
    its structure, current implementation, package manifests, tests, and
    conventions before modifying files. Preserve useful existing work.
2.  **Plan before implementation.** Create or update
    `docs/implementation-plan.md` with milestones, affected files,
    decisions, and verification commands before making broad changes.
3.  **Build in small, verifiable increments.** Implement the Employee
    Dashboard first, then its supporting API and persistence. Run lint,
    type checks, unit tests, API tests, and relevant Playwright tests
    after each milestone.
4.  **No company-specific content.** Do not copy or retain company
    names, logos, employee identities, internal URLs, internal
    identity-provider references, proprietary project names, internal
    issue keys, or company-specific integrations from the screenshots.
    Use neutral sample data and original branding.
5.  **Recreate functionality, not hidden implementation.** Use the
    screenshots as visual/behavioral references for a weekly timesheet
    dashboard and add-entry panel. Do not attempt to access or
    reverse-engineer any source application.
6.  **No fake completion.** Do not mark a feature complete unless its
    code exists and the relevant checks have been run. Report commands
    and actual results.
7.  **Security first.** Never hard-code credentials, tokens, production
    URLs, or secrets. Use environment variables and a committed
    `.env.example` containing placeholders only.
8.  **Avoid premature complexity.** Start with a modular monolith: one
    React frontend, one FastAPI backend, and one PostgreSQL database. Do
    not introduce microservices unless a later requirement justifies
    them.
9.  **No placeholder-only core flows.** The first milestone must persist
    time entries through the API and database. A frontend-only mock may
    be used temporarily for layout development, but must be replaced
    before calling the milestone complete.
10. If a decision is unspecified, choose a conservative, documented
    default and record it in `docs/decisions.md`. Do not block progress
    on nonessential questions.

### Initial repository assessment

Before implementation:

-   List the current files and identify the project root.
-   Check Git status and do not overwrite unrelated changes.
-   Identify installed runtime/tool versions.
-   Determine whether the repository already has frontend, backend,
    test, Docker, or CI configuration.
-   Summarize the current state and propose a minimal implementation
    plan.
-   If the repository is empty, initialize the structure in Section 5.

------------------------------------------------------------------------

## 2. Product overview

### 2.1 Purpose

Create an independently branded web application that allows employees to
record work hours, organize entries by date/project/task, save drafts,
and submit a weekly timesheet for manager approval. Managers will later
review, approve, or reject submissions. Administrators will later manage
users, teams, projects, tasks, earning codes, and business rules.

### 2.2 Product principles

-   Clear and efficient time entry.
-   Week-first navigation with visible daily and weekly totals.
-   Day and Week entry modes.
-   Predictable draft and submission lifecycle.
-   Accessible, responsive UI.
-   Server-side validation and authorization.
-   Traceable approval decisions.
-   Configurable business rules rather than hard-coded company policies.
-   Testability through stable accessible locators and deterministic
    test data.

### 2.3 Scope boundaries

**In scope**

-   Employee dashboard and weekly timesheet.
-   Day-mode and Week-mode time-entry forms.
-   Projects, project tasks, earning codes, descriptions, and hours.
-   Draft creation, editing, deletion, and weekly submission.
-   Weekly summaries, capped/non-capped classifications, and entry
    counts.
-   Backend API, PostgreSQL persistence, authentication/authorization
    foundation.
-   Automated tests using Playwright and backend testing tools.
-   A foundation for manager approvals and administration.

**Out of scope for the first milestone**

-   Payroll processing or payment execution.
-   Direct integrations with any employer's identity system, HR system,
    project tracker, or internal portal.
-   Production deployment to a specific cloud provider.
-   Mobile native applications.
-   Complex multi-level approvals.
-   Automated timesheet creation from activity-monitoring software.
-   Company-specific earning-code policies.
-   Real email/SMS delivery; use a notification abstraction and a
    development implementation until configured.

### 2.4 Roles

-   **Employee:** create and maintain their own draft entries, submit a
    week, and view status.
-   **Manager:** later review submissions for explicitly assigned team
    members and approve/reject them.
-   **Administrator:** later manage users, teams, projects, tasks,
    earning codes, and policy configuration.
-   **System/service:** perform validation, status transitions, audit
    recording, and notification dispatch.

A user's role must be checked by the backend. Hiding a button in the
frontend is not authorization.

------------------------------------------------------------------------

## 3. Reference UI and required behavior

Use the provided screenshots as visual references for the following
concepts:

1.  Main dashboard with a weekly date range and previous/next week
    navigation.
2.  Seven daily cards showing day, date, and logged hours.
3.  Weekly summary with total hours, capped hours, non-capped hours,
    entry count, and draft count.
4.  A scrollable "Add Time Entry" side panel.
5.  Day and Week entry modes.
6.  Fields for date/week, hours, earning code, project, task, and work
    description.
7.  A weekly day selector and calculated total in Week mode.
8.  Save Entry and Cancel actions.
9.  A Submit action for the current week.
10. A separate manager approval workflow in a later milestone.

Create an original, neutral design. Do not reproduce company names,
logos, profile details, internal links, internal version strings, or
company-specific colors/branding. A teal/blue-green accent, neutral
surfaces, readable typography, and responsive spacing are reasonable
starting choices.

### 3.1 Dashboard layout

Recommended desktop layout:

-   Header: app name, current page title, user menu, and sign-out.
-   Week navigation: previous week, date-range label, next week,
    optional "current week" shortcut.
-   Daily cards: Sunday through Saturday or a configurable locale-based
    week start. The initial default is Monday-first for date
    calculations, but the UI may display the locale-selected order. Keep
    the date range and week-start rule consistent throughout the app.
-   Weekly summary: total, capped, non-capped, entry count, draft count,
    and current status.
-   Entry list grouped by date, with project/task, description, hours,
    earning-code classification, status, and permitted row actions.
-   Primary "Add entry" action.
-   Submit-week action with confirmation and validation errors.
-   Empty state when no entries exist.

Avoid a permanently fixed bottom submit button if it obscures entry
content. If a sticky action area is used, account for mobile viewports
and keyboard navigation.

### 3.2 Weekly navigation

-   A week is a seven-day date interval based on a configurable
    `week_start_day`; default Monday.
-   Store dates as ISO date values (`YYYY-MM-DD`) in the business
    timezone. Do not derive business dates from UTC timestamps without
    timezone conversion.
-   Previous/next controls load the correct interval and fetch its
    entries.
-   Changing weeks must not discard unsaved form state without warning.
-   The current week may have a shortcut.
-   Disable or constrain future/past navigation only if a documented
    business policy requires it; do not invent restrictions.

### 3.3 Daily cards

Each card shows:

-   Day abbreviation.
-   Calendar date.
-   Sum of hours for that date.
-   Optional visual indication when entries exist or the day is
    selected.

The sum must be calculated from persisted entries returned by the
backend, or from a shared, deterministic client-side aggregation of
those entries. The backend remains authoritative for submission
validation.

### 3.4 Weekly summary

Show:

-   `total_hours`: sum of all eligible entries in the selected week.
-   `capped_hours`: sum classified as capped by the configured
    earning-code/policy rules.
-   `non_capped_hours`: sum classified as non-capped.
-   `entry_count`: number of entries in the selected week.
-   `draft_count`: number of draft entries, if meaningful for the
    selected lifecycle.
-   Overall week status: Draft, Submitted, Approved, or Rejected.

For the initial implementation, classifications are determined by
configurable earning-code metadata, not inferred from the description.
Capped + non-capped should equal total for entries included in the
summary. Use decimal-safe arithmetic; do not use floating-point
arithmetic for authoritative persisted hour totals. Represent hours as
decimal values with a defined precision, such as `NUMERIC(5,2)`.

### 3.5 Entry list

Each row/card should include:

-   Work date.
-   Project.
-   Task, when selected.
-   Description.
-   Hours.
-   Earning code.
-   Entry status or week status as appropriate.
-   Edit and delete actions only when allowed.

Group entries by date. Preserve long descriptions with sensible
truncation/expansion and avoid overflow. Provide a clear empty state.

### 3.6 Add Time Entry panel --- Day mode

Required fields:

-   **Entry mode:** Day / Week toggle.
-   **Date:** required date input, defaulting to the selected day or a
    reasonable date within the selected week.
-   **Hours:** required decimal input, positive and within the
    configured per-entry limit.
-   **Earning code:** required selection.
-   **Project:** required searchable selection.
-   **Task:** required only if the selected project has tasks or policy
    requires one; disabled until a project is selected.
-   **Description:** required text area with a documented maximum
    length, initially 256 characters.
-   **Save Entry** and **Cancel** actions.

Behavior:

-   Changing project clears the task selection if that task does not
    belong to the new project.
-   Do not submit invalid values.
-   Display field-level errors and an accessible form-level summary when
    needed.
-   Keep entered values if the server returns a validation error.
-   On successful save, close the panel, refresh the relevant entries
    and summaries, and show a success message.
-   Cancel closes the panel. If values have changed, ask for
    confirmation before discarding them.
-   Edit mode uses the same panel with existing values populated.
-   Deleting an entry requires confirmation and is permitted only when
    the entry/week is editable.

### 3.7 Add Time Entry panel --- Week mode

Week mode allows a user to enter hours for multiple dates using a shared
project/task/earning-code/description.

-   Display the selected week.
-   Display one control per day in that week.
-   Allow a day to be enabled/disabled for this entry.
-   Allow a non-negative hour value for each enabled day.
-   Display the calculated total as the sum of enabled day values.
-   Require at least one enabled day with a positive number of hours.
-   Validate each date and each hour value on the backend.
-   Save the week-mode form as separate date-specific time-entry records
    in a single API request/transaction.
-   Do not silently replace existing entries. If editing an existing
    entry, preserve clear edit semantics; if creating multiple entries,
    each created record must be identifiable.
-   If any item fails validation, the entire batch should fail
    atomically unless an explicit partial-success contract is introduced
    later.
-   Preserve values and show which day failed validation.

### 3.8 Submission

-   Submit only entries belonging to the authenticated employee and
    selected week.
-   Validate that the week contains at least one entry.
-   Validate each entry, project/task relationship, earning code, date,
    hours, and any configured weekly policy.
-   Reject submission if there are unresolved invalid records or if the
    week is already submitted/approved.
-   On success, change the week/submission status to `SUBMITTED`, record
    the submission time, and enqueue a manager notification event.
-   Return the updated week summary/status.
-   Ask for confirmation before submission.
-   After submission, entries become read-only for the employee unless
    the business rules explicitly allow withdrawal or a manager rejects
    the submission.
-   A rejected week returns to an editable state according to the
    defined workflow, with the rejection reason visible.
-   Prevent duplicate submissions using a transaction and state check.
    Support an idempotency key for submission requests where practical.

------------------------------------------------------------------------

## 4. Non-functional requirements

### 4.1 Quality attributes

-   Responsive at desktop, tablet, and mobile widths.
-   Accessibility target: WCAG 2.2 AA practices where practical,
    including keyboard operation, visible focus, labels, contrast, and
    screen-reader announcements.
-   Use semantic HTML and native accessible controls where appropriate.
-   API validation must be server-side.
-   Predictable errors with no stack traces or secret details exposed to
    clients.
-   Logs must avoid passwords, bearer tokens, session cookies, and
    sensitive free-text descriptions.
-   All persisted changes to time entries and submission states should
    be auditable.
-   Use UTC timestamps for events and explicit business dates/timezone
    for timesheets.
-   Keep business logic out of React components and route handlers where
    possible.
-   Ensure deterministic tests and seeded development data.

### 4.2 Performance targets

Initial targets for local/staging testing:

-   Dashboard API p95 response under 500 ms with a realistic development
    dataset.
-   Entry save API p95 under 500 ms under ordinary local/staging load.
-   Avoid unnecessary duplicate requests when switching between days and
    weeks.
-   Use pagination for future manager lists and reports.
-   Do not optimize prematurely; measure before introducing caching or
    background workers.

### 4.3 Browser support

Target current stable Chromium, Firefox, and WebKit through Playwright.
Manually validate a current Chromium-based desktop browser and a narrow
mobile viewport. Do not rely on browser-specific date parsing.

------------------------------------------------------------------------

## 5. Suggested repository structure

Use this structure if the repository is empty. Adapt it if a sound
structure already exists.

``` text
timesheet-app/
├── README.md
├── spec.md
├── docs/
│   ├── implementation-plan.md
│   ├── architecture.md
│   ├── api-contracts.md
│   ├── data-model.md
│   ├── decisions.md
│   └── testing-strategy.md
├── .env.example
├── .gitignore
├── compose.yaml
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── playwright.config.ts
│   └── src/
│       ├── app/
│       ├── components/
│       ├── features/
│       │   ├── dashboard/
│       │   ├── timesheets/
│       │   ├── time-entries/
│       │   └── projects/
│       ├── api/
│       ├── hooks/
│       ├── types/
│       ├── utils/
│       └── styles/
│   └── tests/
│       ├── e2e/
│       └── fixtures/
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/
│   │   ├── api/
│   │   │   └── v1/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── repositories/
│   │   ├── services/
│   │   ├── security/
│   │   └── tests/
│   └── scripts/
└── .github/
    └── workflows/
        └── ci.yml
```

### 5.1 Frontend guidance

-   React + TypeScript + Vite.
-   Use a maintainable component library or accessible custom
    components; document the choice.
-   Use a form library only if it simplifies validation and field state;
    do not over-engineer.
-   Use a typed API client and shared request/response types.
-   Prefer accessible locators and semantic controls.
-   Keep API calls in an API/service layer, not scattered through UI
    components.
-   Avoid global state until shared state needs justify it.
-   Use environment variable `VITE_API_BASE_URL`; never place secrets in
    frontend environment variables.
-   Use ESLint and formatting checks.

### 5.2 Backend guidance

-   Python + FastAPI + Pydantic.
-   SQLAlchemy 2.x with Alembic migrations.
-   PostgreSQL as the default database.
-   Separate API routers, Pydantic schemas, services, repositories, and
    security dependencies.
-   Keep route handlers thin.
-   Use dependency injection for database sessions and authenticated
    users.
-   Use explicit transaction boundaries for batch creation and
    submission.
-   Use consistent error response schemas.
-   Expose OpenAPI docs only according to the deployment configuration.

### 5.3 Local development

Provide Docker Compose for PostgreSQL and optionally the
backend/frontend. Include health checks and documented commands. The app
must also be runnable locally without requiring a production service.
Seed only synthetic users/projects/tasks/earning codes.

------------------------------------------------------------------------

## 6. Architecture

### 6.1 High-level request flow

``` text
Browser (React + TypeScript)
    |
    | HTTPS / JSON REST API
    v
FastAPI application
    |
    +--> Authentication and authorization dependencies
    |
    +--> API routers
    |       |
    |       v
    |    Service layer (business rules / transactions)
    |       |
    |       v
    |    Repository / SQLAlchemy
    |       |
    v       v
PostgreSQL database

Submission service --> notification interface --> development logger/outbox
```

### 6.2 Architectural decisions

-   Begin as a modular monolith.
-   Version API routes under `/api/v1`.
-   Keep database migrations committed.
-   Use UUID primary keys for externally exposed entities.
-   Use database constraints in addition to application validation.
-   Use a notification interface so delivery providers can be added
    without changing timesheet business logic.
-   Avoid coupling the product to a specific employer's SSO or internal
    services.
-   Keep role authorization and ownership checks on the server.

### 6.3 Configuration

Create `.env.example` with placeholders for at least:

``` dotenv
APP_ENV=development
APP_NAME=TimeTrack
API_V1_PREFIX=/api/v1
DATABASE_URL=postgresql+psycopg://timesheet:change-me@localhost:5432/timesheet
CORS_ORIGINS=http://localhost:5173
AUTH_MODE=development
SESSION_SECRET=replace-with-a-long-random-secret
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=7
BUSINESS_TIMEZONE=Asia/Kolkata
WEEK_START_DAY=MONDAY
```

Adapt authentication configuration to the selected implementation. Do
not commit real secrets. Validate required production configuration on
startup. For cookie-based sessions, configure secure cookies in
production. For bearer tokens, validate issuer, audience, signature,
expiry, and intended use. Do not store secrets in local storage by
default.

------------------------------------------------------------------------

## 7. Data model

Use UUID identifiers and UTC audit timestamps. Exact column types and
names may be adjusted, but the relationships and constraints must be
preserved.

### 7.1 `users`

-   `id`: UUID primary key.
-   `email`: unique, normalized.
-   `display_name`: required.
-   `role`: enum/string constrained to `EMPLOYEE`, `MANAGER`, `ADMIN`.
-   `manager_id`: nullable FK to `users.id`.
-   `is_active`: boolean.
-   `created_at`, `updated_at`: timezone-aware timestamps.

Do not use real names or email addresses from screenshots in seed data.

### 7.2 `teams`

-   `id`: UUID primary key.
-   `name`: required.
-   `created_at`, `updated_at`.

### 7.3 `team_memberships`

-   `team_id`: FK to teams.
-   `user_id`: FK to users.
-   Unique `(team_id, user_id)`.
-   Optional effective start/end dates if needed.

### 7.4 `projects`

-   `id`: UUID primary key.
-   `code`: unique.
-   `name`: required.
-   `description`: nullable.
-   `is_active`: boolean.
-   `created_at`, `updated_at`.

### 7.5 `project_tasks`

-   `id`: UUID primary key.
-   `project_id`: FK to projects.
-   `code`: required within project.
-   `name`: required.
-   `is_active`: boolean.
-   Unique `(project_id, code)`.

A task must belong to the selected project. Enforce this in the service
layer and, where practical, with database constraints.

### 7.6 `earning_codes`

-   `id`: UUID primary key.
-   `code`: unique.
-   `name`: required.
-   `classification`: `CAPPED` or `NON_CAPPED`.
-   `is_active`: boolean.
-   Optional policy metadata, with business rules documented.
-   `created_at`, `updated_at`.

Do not infer classification from project names or descriptions.

### 7.7 `timesheet_weeks`

Represents an employee's weekly submission aggregate.

-   `id`: UUID primary key.
-   `employee_id`: FK to users.
-   `week_start_date`: date.
-   `week_end_date`: date, exactly six days after start.
-   `status`: `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`.
-   `submitted_at`: nullable timestamp.
-   `reviewed_at`: nullable timestamp.
-   `reviewed_by`: nullable FK to users.
-   `review_comment`: nullable text.
-   `created_at`, `updated_at`: timezone-aware timestamps.
-   Unique `(employee_id, week_start_date)`.

Use a transaction and lock/check the week row when changing lifecycle
state. Ensure the week date range is consistent with the configured
week-start policy.

### 7.8 `time_entries`

-   `id`: UUID primary key.
-   `timesheet_week_id`: FK to `timesheet_weeks`.
-   `employee_id`: FK to users, retained for ownership queries and
    consistency.
-   `work_date`: date.
-   `hours`: `NUMERIC(5,2)`; greater than zero and not above configured
    per-entry maximum.
-   `earning_code_id`: FK to earning_codes.
-   `project_id`: FK to projects.
-   `task_id`: nullable FK to project_tasks.
-   `description`: required, maximum 256 characters initially.
-   `created_at`, `updated_at`: timezone-aware timestamps.
-   Optional optimistic concurrency field `version`.

Validate that `work_date` falls inside the parent week and that
`employee_id` matches the parent timesheet owner. Use database checks
for positive hours and reasonable bounds. If task is present, validate
that it belongs to the selected project.

### 7.9 `approval_events`

-   `id`: UUID primary key.
-   `timesheet_week_id`: FK.
-   `actor_id`: FK to users.
-   `action`: `SUBMITTED`, `APPROVED`, `REJECTED`, optionally
    `WITHDRAWN`.
-   `comment`: nullable text.
-   `created_at`: timezone-aware timestamp.

This is append-only audit history. Do not overwrite old approval events
when the status changes.

### 7.10 `notification_outbox` (recommended foundation)

-   `id`: UUID primary key.
-   `event_type`: required.
-   `aggregate_id`: related timesheet/week UUID.
-   `payload`: JSONB containing only necessary notification metadata.
-   `status`: `PENDING`, `PROCESSING`, `SENT`, `FAILED`.
-   `attempt_count`, `created_at`, `processed_at`, `last_error`.

For the first milestone, a simple development notification adapter may
log a safe event. The outbox should not block delivery of the API
response. Do not log tokens or full free-text descriptions.

### 7.11 Indexes and integrity

Add indexes for:

-   `timesheet_weeks(employee_id, week_start_date)`.
-   `timesheet_weeks(status, week_start_date)`.
-   `time_entries(timesheet_week_id, work_date)`.
-   `time_entries(employee_id, work_date)`.
-   `project_tasks(project_id, is_active)`.
-   `approval_events(timesheet_week_id, created_at)`.

Use foreign keys and appropriate delete policies. Avoid cascading
deletion of approval/audit history. Prefer soft-deactivation for users,
projects, tasks, and earning codes referenced by historical entries.

------------------------------------------------------------------------

## 8. API conventions

Base path: `/api/v1`.

### 8.1 General conventions

-   JSON request and response bodies.
-   UUIDs represented as strings.
-   Dates use `YYYY-MM-DD`.
-   Timestamps use ISO 8601 with timezone.
-   Hours use decimal values with at most two decimal places.
-   Return meaningful HTTP status codes.
-   Validate all request fields using Pydantic and database constraints.
-   Return a consistent error structure.
-   Do not expose SQL, stack traces, or secrets in error responses.
-   Apply authentication and resource authorization to all private
    endpoints.

Suggested error format:

``` json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "field_errors": {
      "hours": "Hours must be greater than zero."
    },
    "request_id": "opaque-request-id"
  }
}
```

### 8.2 Authentication endpoints

Exact routes depend on the chosen auth mode. For a local credential
implementation:

-   `POST /auth/login`
-   `POST /auth/logout`
-   `GET /auth/me`
-   `POST /auth/refresh` only if refresh-token rotation is implemented
    safely.

Never return a password hash. Rate-limit login attempts and avoid user
enumeration. A development-only seeded-login shortcut must be disabled
outside development.

### 8.3 Reference data

#### `GET /projects?active=true&search=...`

Returns projects the current user may use.

Example response:

``` json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000101",
      "code": "PRJ-001",
      "name": "Platform Development",
      "is_active": true
    }
  ]
}
```

#### `GET /projects/{project_id}/tasks?active=true`

Returns tasks for the selected project only.

#### `GET /earning-codes?active=true`

Returns active earning codes and their classification.

### 8.4 Dashboard

#### `GET /timesheets/weeks/{week_start_date}`

Returns the authenticated employee's timesheet week and summary. The
path date must be a valid configured week start; alternatively normalize
it consistently and return the normalized date.

Example response:

``` json
{
  "id": "00000000-0000-4000-8000-000000000201",
  "week_start_date": "2026-10-19",
  "week_end_date": "2026-10-25",
  "status": "DRAFT",
  "submitted_at": null,
  "summary": {
    "total_hours": "16.00",
    "capped_hours": "16.00",
    "non_capped_hours": "0.00",
    "entry_count": 2,
    "draft_count": 2
  },
  "daily_totals": [
    {"date": "2026-10-19", "hours": "8.00"},
    {"date": "2026-10-20", "hours": "8.00"}
  ],
  "entries": []
}
```

The example is illustrative synthetic data. Do not hard-code this
response in the real API.

If no week exists, either return an empty draft representation or create
the draft aggregate idempotently. Choose one approach, document it, and
make repeated GET requests safe. Do not create duplicate week records.

### 8.5 Time entries

#### `POST /time-entries`

Creates a single entry in a draft week.

Request:

``` json
{
  "work_date": "2026-10-21",
  "hours": "8.00",
  "earning_code_id": "00000000-0000-4000-8000-000000000301",
  "project_id": "00000000-0000-4000-8000-000000000101",
  "task_id": "00000000-0000-4000-8000-000000000401",
  "description": "Implementation and code review"
}
```

Response: `201 Created` with the persisted entry representation.

Server responsibilities:

-   Resolve or create the authenticated employee's draft week.
-   Confirm the date belongs to that week.
-   Confirm the week is editable.
-   Confirm project and earning code are active and allowed.
-   Confirm task belongs to project if supplied.
-   Validate hours and description.
-   Persist transactionally.

#### `PATCH /time-entries/{entry_id}`

Updates an existing entry only if the current user owns it and its week
is editable. Return `200 OK`.

#### `DELETE /time-entries/{entry_id}`

Deletes an entry only if the current user owns it and its week is
editable. Return `204 No Content`.

#### `POST /time-entries/batch`

Creates multiple entries for Week mode in a single transaction.

Request:

``` json
{
  "entries": [
    {
      "work_date": "2026-10-19",
      "hours": "8.00",
      "earning_code_id": "00000000-0000-4000-8000-000000000301",
      "project_id": "00000000-0000-4000-8000-000000000101",
      "task_id": null,
      "description": "Planning and implementation"
    },
    {
      "work_date": "2026-10-20",
      "hours": "6.00",
      "earning_code_id": "00000000-0000-4000-8000-000000000301",
      "project_id": "00000000-0000-4000-8000-000000000101",
      "task_id": null,
      "description": "Implementation and testing"
    }
  ]
}
```

Response: `201 Created` with created entries and the updated summary.
Validate all items first and commit all or none.

### 8.6 Submission

#### `POST /timesheets/weeks/{week_start_date}/submit`

Request:

``` json
{
  "comment": null
}
```

Response: `200 OK` with the updated week status and summary.

The service must atomically validate and transition the week from
`DRAFT` (or an explicitly supported editable `REJECTED` state) to
`SUBMITTED`, create an audit event, and enqueue a notification event.

Return `409 Conflict` for invalid lifecycle transitions and
`422 Unprocessable Entity` for business-rule validation failures,
following the API's consistent error contract.

### 8.7 Manager endpoints --- later milestone

-   `GET /approvals?status=SUBMITTED&week_start_date=YYYY-MM-DD`
-   `GET /approvals/{timesheet_week_id}`
-   `POST /approvals/{timesheet_week_id}/approve`
-   `POST /approvals/{timesheet_week_id}/reject`

Reject request:

``` json
{
  "comment": "Please correct the hours recorded for Tuesday."
}
```

Only authorized managers assigned to the employee/team may review the
timesheet. An administrator may have explicitly defined oversight
permissions, but must not silently bypass audit requirements. Require a
meaningful rejection reason. Each decision must be transactional and
append an audit event.

------------------------------------------------------------------------

## 9. Business rules

Implement these as centralized service/policy functions with unit tests.

1.  An employee can view and modify only their own draft or otherwise
    explicitly editable timesheets.
2.  A manager can review only authorized employees' submitted
    timesheets.
3.  A week has seven calendar dates and a single canonical start/end
    date.
4.  Every entry's date must fall inside its parent week.
5.  Hours must be greater than zero and within configured limits.
6.  Decimal precision is two digits after the decimal point unless
    configuration states otherwise.
7.  Project and earning code must be active when a new entry is created.
8.  If a task is selected, it must belong to the selected project.
9.  Entry description is required and limited to 256 characters
    initially.
10. Capped/non-capped classification comes from earning-code
    configuration.
11. A submitted or approved timesheet is read-only for the employee.
12. Rejection must preserve review history and expose the rejection
    reason.
13. Submission must be safe against concurrent duplicate requests.
14. Time-entry batch creation is all-or-nothing.
15. The server recalculates totals; never trust client-submitted totals.
16. Deactivation of reference data must not erase historical records.
17. Every status transition must be auditable.
18. Business rules such as daily/weekly maximum hours, future-date
    rules, mandatory tasks, and allowed date ranges must be configurable
    and documented. Do not invent jurisdiction-specific labor rules.

------------------------------------------------------------------------

## 10. Frontend component requirements

Create small components with clear responsibilities. Suggested
components:

-   `AppShell`
-   `AppHeader`
-   `UserMenu`
-   `WeekNavigator`
-   `DailyHoursCard`
-   `WeeklySummary`
-   `TimesheetStatusBadge`
-   `TimeEntryList`
-   `TimeEntryCard`
-   `TimeEntryFormPanel`
-   `EntryModeToggle`
-   `DayHoursFields`
-   `WeekHoursGrid`
-   `ProjectCombobox`
-   `TaskSelect`
-   `EarningCodeSelect`
-   `FormFieldError`
-   `ConfirmDialog`
-   `Toast/LiveRegion`
-   `LoadingSkeleton`
-   `EmptyState`
-   `ErrorState`

Do not create one giant dashboard component. Keep API data loading,
validation, and date/hour calculations in hooks or service modules.

### 10.1 UI states

Every data-driven view must handle:

-   Initial loading.
-   Empty results.
-   Successful loaded state.
-   API/network error with retry.
-   Saving state that prevents duplicate submission.
-   Validation error.
-   Unauthorized session/expired session.
-   Read-only submitted/approved state.
-   Confirmation dialogs for destructive or irreversible actions.

### 10.2 Form accessibility

-   Every input has a visible label.
-   Required fields are indicated in text and programmatically.
-   Errors are associated with inputs using accessible descriptions.
-   Keyboard users can open, navigate, and close the panel.
-   Focus moves into the panel when opened and returns to the triggering
    control when closed.
-   Escape closes the panel only when doing so does not bypass a
    required confirmation.
-   A successful save or submission is announced via an accessible live
    region.
-   Do not use color alone to convey status.

### 10.3 Visual design

-   Original, neutral brand and design tokens.
-   Clear contrast and readable text.
-   Consistent spacing, border radius, and focus indicators.
-   Desktop layout similar in information hierarchy to the references.
-   On small screens, stack summary cards and use a full-screen or
    bottom-sheet entry form.
-   Avoid pixel-perfect reproduction of company branding or internal
    portal chrome.
-   Do not use copied company logos, names, profile details, or
    screenshots as application assets.

------------------------------------------------------------------------

## 11. Authentication and security

### 11.1 Authentication

Choose one independent implementation and document it:

-   Preferred for production: standards-based OIDC using a provider
    configured by the application owner.
-   For a self-contained prototype: local email/password authentication
    using a vetted password-hashing library and secure session handling.

Do not integrate with any company-specific identity provider shown in
the references.

### 11.2 Authorization

-   Use a backend dependency to require authentication on private
    routes.
-   Check ownership of each timesheet and entry.
-   Check manager-to-employee/team authorization for approval routes.
-   Deny by default.
-   Do not accept `employee_id`, `role`, or reviewer identity from
    client payloads as authoritative. Derive actor identity from the
    authenticated principal.
-   Return `404` or `403` consistently according to a documented policy
    to avoid unnecessary resource enumeration.

### 11.3 Web security

-   Use HTTPS in deployed environments.
-   Configure CORS to explicit allowed origins; never use wildcard
    origins with credentials.
-   If using cookies, configure `HttpOnly`, `Secure`, and suitable
    `SameSite` settings; implement CSRF protections where applicable.
-   If using bearer tokens, protect token storage and implement
    expiration/rotation/revocation appropriately.
-   Apply rate limiting to authentication and sensitive operations.
-   Validate and normalize inputs.
-   Use SQLAlchemy parameterized queries; never interpolate untrusted
    SQL.
-   Render descriptions as text, not raw HTML.
-   Keep secrets out of source control, frontend bundles, logs, and
    error messages.
-   Set security headers in deployment.
-   Use dependency and container vulnerability scanning in CI where
    practical.
-   Do not log authentication credentials, tokens, session IDs, or
    sensitive free-text descriptions.

### 11.4 Audit and privacy

Record who submitted, approved, or rejected a week and when. Keep an
immutable event history. Collect only the user data necessary for the
application. Provide documented retention/deletion policies before
production deployment.

------------------------------------------------------------------------

## 12. Testing strategy

### 12.1 Backend tests

Use `pytest` and FastAPI's test client or HTTPX.

Test:

-   Week date calculations, including month/year boundaries and leap
    years.
-   Decimal hour validation and totals.
-   Capped/non-capped aggregation.
-   Entry date inside week.
-   Project/task relationship validation.
-   Inactive project and earning-code rejection.
-   Entry ownership and role authorization.
-   Batch all-or-nothing behavior.
-   Submission lifecycle and duplicate submissions.
-   Concurrent submission protection where feasible.
-   Audit event creation.
-   Error response consistency.
-   Database migrations against PostgreSQL in integration tests.

Use an isolated test database. Do not run destructive tests against a
developer's normal database.

### 12.2 Frontend unit/component tests

Use the selected React testing tools to test:

-   Week navigation and displayed dates.
-   Daily and weekly summary calculations.
-   Day/Week mode switching.
-   Conditional task selection.
-   Field validation and error rendering.
-   Loading, empty, error, and read-only states.
-   Confirmation dialogs.
-   Keyboard and accessible-label behavior.

### 12.3 Playwright end-to-end tests

Use Playwright with TypeScript. Use stable locators based on roles,
labels, and explicit test IDs only where necessary. Avoid brittle CSS
selectors and arbitrary sleeps.

Required first-milestone E2E scenarios:

1.  Employee can sign in using a test account in the test environment.
2.  Dashboard shows the selected week and seven daily cards.
3.  Employee opens Add Time Entry in Day mode.
4.  Required-field validation is displayed.
5.  Employee selects a project and then a valid task.
6.  Employee saves an entry and sees it in the list and daily total.
7.  Employee edits a draft entry and sees updated totals.
8.  Employee cancels an edited form and is warned before losing changes.
9.  Employee deletes a draft entry after confirmation.
10. Employee creates a multi-day entry using Week mode and sees the
    calculated total.
11. Invalid batch input is rejected without partially saving records.
12. Weekly summary totals match persisted API data.
13. Employee submits a valid week and sees `Submitted`.
14. Submitted entries become read-only.
15. Employee cannot access another employee's timesheet by changing an
    ID or URL.
16. A failed API request displays a useful error and retry path.
17. Narrow viewport remains usable and the entry panel does not obscure
    required controls.

Manager E2E scenarios are added in the manager milestone.

### 12.4 Test data and fixtures

-   Use synthetic accounts and projects.
-   Store credentials in local test environment variables or dedicated
    CI secrets.
-   Seed deterministic reference data for tests.
-   Clean up test records or use isolated test databases.
-   Do not depend on real user accounts or external production systems.
-   Avoid `waitForTimeout`/`Thread.Sleep` equivalents. Wait for a
    meaningful UI state, response, or locator condition.
-   Tests must not rely on execution order unless a fixture explicitly
    creates the dependency.

### 12.5 CI quality gates

CI should run:

-   Frontend dependency installation with lockfile.
-   Frontend lint and type checking.
-   Frontend unit tests.
-   Backend lint/type checks where configured.
-   Backend unit/integration tests.
-   Database migration verification.
-   Playwright E2E tests against a test environment.
-   Build checks for frontend and backend.
-   Optional dependency and security scans.

Fail CI on a failing required check. Document how to run each command
locally.

------------------------------------------------------------------------

## 13. Phased implementation plan

### Phase 0 --- Repository discovery and planning

Deliverables:

-   Repository assessment.
-   `docs/implementation-plan.md`.
-   `docs/architecture.md`.
-   `docs/decisions.md`.
-   Confirmed toolchain and exact local run commands.

Acceptance criteria:

-   Existing work is preserved.
-   Architecture and unresolved decisions are documented.
-   No production credentials are required to start development.

### Phase 1 --- Foundation

Implement:

-   Frontend and backend project skeletons.
-   PostgreSQL via Docker Compose.
-   Environment configuration and validation.
-   Health endpoints.
-   SQLAlchemy session management.
-   Alembic migrations.
-   Structured logging and consistent error format.
-   Basic CI.
-   Seed data containing synthetic projects, tasks, earning codes, and
    users.
-   Authentication foundation and authorization dependency.

Acceptance criteria:

-   Frontend starts.
-   Backend starts.
-   Database health check passes.
-   Migrations apply from an empty database.
-   No secrets are committed.
-   Basic health and configuration tests pass.

### Phase 2 --- Employee Dashboard and read APIs

Implement:

-   Dashboard page and app shell.
-   Week navigator.
-   Daily cards.
-   Weekly summary.
-   Entry list grouped by date.
-   Reference-data APIs for projects, tasks, and earning codes.
-   Week summary API.
-   Loading, empty, and error states.

Acceptance criteria:

-   Week navigation returns correct dates.
-   Daily and weekly totals are consistent.
-   All data is fetched from the API, not hard-coded in production
    components.
-   UI is responsive and keyboard accessible.
-   Unit and API tests pass.

### Phase 3 --- Day-mode time entry

Implement:

-   Add-entry panel.
-   Project, task, earning code, hours, date, and description fields.
-   Create, edit, and delete APIs.
-   Server-side validation.
-   Refresh of daily and weekly totals after mutation.
-   Confirmation and error states.

Acceptance criteria:

-   Valid entries persist in PostgreSQL.
-   Invalid entries are rejected with field errors.
-   Project/task relationships are enforced.
-   Employees cannot edit another employee's entries.
-   Draft entries can be edited/deleted.
-   Playwright CRUD scenarios pass.

### Phase 4 --- Week-mode entry

Implement:

-   Day enable/disable controls.
-   Hours input per date.
-   Live total calculation.
-   Atomic batch API.
-   Per-day validation display.

Acceptance criteria:

-   Multiple entries are created in one transaction.
-   Invalid batch input does not partially persist.
-   Total matches the saved entries.
-   Switching modes does not silently lose data.
-   Playwright Week-mode scenarios pass.

### Phase 5 --- Weekly submission

Implement:

-   Submit confirmation.
-   Server-side weekly validation.
-   Status transitions.
-   Audit events.
-   Notification/outbox abstraction.
-   Read-only state after submission.

Acceptance criteria:

-   Valid draft week becomes `SUBMITTED`.
-   Invalid week remains editable and explains errors.
-   Duplicate submission is safely handled.
-   Audit event is created.
-   Notification event is enqueued.
-   Employee cannot modify a submitted week.
-   Submission E2E tests pass.

### Phase 6 --- Manager approvals

Implement:

-   Manager dashboard and pending list.
-   Team/manager authorization.
-   Timesheet detail/review.
-   Approve and reject actions.
-   Required rejection reason.
-   Audit history.
-   Employee notification of decisions.

Acceptance criteria:

-   Only authorized managers can access assigned submissions.
-   Approved/rejected status persists.
-   Rejection reason is visible to the employee.
-   All decisions are auditable.
-   Manager and employee workflow E2E tests pass.

### Phase 7 --- Administration and hardening

Implement as prioritized:

-   User/team management.
-   Project/task/earning-code management.
-   Configurable hour policies.
-   Reporting and pagination.
-   Security review.
-   Performance testing.
-   Backup/restore guidance.
-   Retention policy.
-   Deployment documentation and production configuration.

Acceptance criteria:

-   Configuration changes are validated and auditable.
-   Security and regression suites pass.
-   Operational and deployment instructions are complete.
-   Performance results are measured and documented.

------------------------------------------------------------------------

## 14. Definition of done

A feature is complete only when:

-   Requirements and acceptance criteria are satisfied.
-   Backend validation and authorization are implemented where relevant.
-   Loading, empty, success, and failure states exist.
-   Keyboard/accessibility basics are covered.
-   Unit/API tests exist and pass.
-   Relevant Playwright tests exist and pass.
-   No unrelated changes or secrets are committed.
-   Documentation and API contracts are updated.
-   The feature has been manually smoke-tested where applicable.
-   Claude Code reports the files changed, commands run, results, and
    remaining gaps honestly.

------------------------------------------------------------------------

## 15. Required deliverables

By the end of the initial implementation, provide:

1.  A runnable React + TypeScript frontend.
2.  A runnable FastAPI backend.
3.  PostgreSQL schema and Alembic migrations.
4.  Synthetic seed data.
5.  Secure authentication/authorization foundation.
6.  Employee dashboard with week navigation and summaries.
7.  Day-mode entry CRUD.
8.  Week-mode atomic batch entry.
9.  Weekly submission lifecycle.
10. Backend and frontend tests.
11. Playwright E2E suite.
12. Docker Compose and `.env.example`.
13. README with prerequisites, setup, migrations, seed commands, test
    commands, and troubleshooting.
14. Architecture, data model, API, decision, and testing documents.
15. A concise implementation report listing completed phases,
    verification results, and known limitations.

------------------------------------------------------------------------

## 16. Final instruction to Claude Code

Start by inspecting the repository and reporting its current state. Then
create a phased implementation plan and implement **Phase 0 through
Phase 2 first**, unless the user explicitly asks for a broader
implementation in one pass.

Do not stop after producing plans or static mockups: once the plan is
recorded, implement the agreed phase. Keep the application independent
and free of company-specific branding or integrations. Verify each phase
with actual commands and tests, and report the results truthfully.

The Employee Dashboard is the first product milestone. Keep the manager
approval workflow and administration in the architecture, but do not let
those later features delay a functional, persisted employee timesheet
experience.
