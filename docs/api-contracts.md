# API contracts (implemented in Phases 1–7)

Base path `/api/v1`. JSON. Dates `YYYY-MM-DD`. Hours are decimal **strings** with two places.
Interactive docs: `/api/v1/docs` when enabled (development/test by default). Unsafe methods
(`POST`/`PUT`/`PATCH`/`DELETE`) must send `X-Requested-With: timetrack`.

## Errors

Every error uses one envelope (validation, auth, unknown routes, 5xx):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "field_errors": { "field": "…" }, "request_id": "…" } }
```

| Status | `code` | When |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` / `INVALID_CREDENTIALS` | no/expired/revoked session; wrong credentials (same message for unknown user) |
| 403 | `FORBIDDEN` / `PASSWORD_CHANGE_REQUIRED` | missing CSRF header, disallowed `Origin`, insufficient role (every `/approvals`, `/reports` route for employees; every `/admin` route for non-admins); trying to review your own week; a temporary password has not been replaced yet (every route except `me`, `change-password`, `logout`) |
| 409 | `WEEK_NOT_EDITABLE` / `STALE_ENTRY` / `INVALID_TRANSITION` / `CONFLICT` / `LAST_ADMIN` / `CLASSIFICATION_LOCKED` | the week is submitted/approved; the entry's `version` no longer matches; the week is not DRAFT/REJECTED so it cannot be submitted; a duplicate email/code/name (also carries `field_errors`); removing the last active administrator; reclassifying an earning code that entries use |
| 404 | `NOT_FOUND` | unknown route or resource; **also another employee's entry** (indistinguishable from missing) |
| 405 | `METHOD_NOT_ALLOWED` | |
| 422 | `VALIDATION_ERROR` / `BUSINESS_RULE_VIOLATION` | malformed input; week date outside 1970–2100 / a well-formed request the business rules refuse (submission) |
| 429 | `RATE_LIMITED` | login throttle (`Retry-After` header) |
| 500 | `INTERNAL_ERROR` | generic message, details only in server logs |
| 503 | `SERVICE_UNAVAILABLE` | readiness check cannot reach the database |

The `X-Request-ID` response header equals `error.request_id`; a valid inbound `X-Request-ID` is echoed.

## Endpoints

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /health` | none | Liveness |
| `GET /health/ready` | none | Database reachable |
| `POST /auth/login` `{email, password}` | none | Returns the user; sets `HttpOnly` `SameSite=Lax` session cookie (`Secure` in production) |
| `POST /auth/logout` | none | 204; revokes the session server-side |
| `GET /auth/me` | session | `{id, email, display_name, role, must_change_password}` |
| `POST /auth/change-password` `{current_password, new_password}` | session + CSRF | 204; revokes the caller's *other* sessions; 422 field errors (`current_password`, `new_password`); 429 when throttled |
| `GET /meta` | session | `{app_name, business_timezone, week_start_day, today, current_week_start_date, max_hours_per_entry, description_max_length}` — `today` is the business date computed on the server |
| `GET /projects?active=true&search=` | session | `{items:[{id, code, name, is_active}]}`; `search` matches code or name, case-insensitive, ≤ 100 chars, wildcards literal |
| `GET /projects/{id}/tasks?active=true` | session | `{items:[{id, project_id, code, name, is_active}]}`; 404 for unknown project |
| `GET /earning-codes?active=true` | session | `{items:[{id, code, name, classification, is_active}]}` |
| `GET /timesheets/weeks/{date}` | session | The caller's week containing `date` (normalised to the week start) |
| `POST /time-entries` | session + CSRF | Create an entry (201) |
| `POST /time-entries/batch` | session + CSRF | Week mode: create several entries for one week atomically (201) |
| `POST /timesheets/weeks/{date}/submit` | session + CSRF | Submit the caller's week for approval (200) |
| `GET /approvals` | manager/admin | Paginated list of weeks to review (see below) |
| `GET /approvals/{week_id}` | manager/admin | Review detail: employee, full week, history |
| `POST /approvals/{week_id}/approve` | manager/admin + CSRF | Approve a submitted week (200) |
| `POST /approvals/{week_id}/reject` | manager/admin + CSRF | Reject with a required reason (200) |
| `PATCH /time-entries/{id}` | session + CSRF | Partial update (200) |
| `DELETE /time-entries/{id}` | session + CSRF | Delete (204) |

### `GET /timesheets/weeks/{date}`

Read-only and idempotent: if no week row exists it returns an empty draft with `"id": null`
(decision D-6). Entries and totals always come from persisted rows, scoped to the authenticated
user — no employee id is accepted from the client.

```json
{
  "id": "uuid | null",
  "week_start_date": "2026-10-19", "week_end_date": "2026-10-25",
  "status": "DRAFT | SUBMITTED | APPROVED | REJECTED",
  "submitted_at": null, "reviewed_at": null, "review_comment": null,
  "is_editable": true,
  "summary": { "total_hours": "34.00", "capped_hours": "31.50", "non_capped_hours": "2.50",
               "entry_count": 6, "draft_count": 6 },
  "daily_totals": [ { "date": "2026-10-19", "hours": "8.00" } ],
  "entries": [ { "id": "uuid", "work_date": "2026-10-19", "hours": "8.00", "description": "…", "version": 1,
                 "project": {"id": "…", "code": "…", "name": "…"},
                 "task": {"id": "…", "code": "…", "name": "…"} ,
                 "earning_code": {"id": "…", "code": "…", "name": "…", "classification": "CAPPED"} } ]
}
```

`daily_totals` always has seven entries. `capped_hours + non_capped_hours = total_hours`.
`draft_count` counts entries while the week is `DRAFT` or `REJECTED`, otherwise 0.

## Time entries (Phase 3)

Requests are validated in full and **all** field problems are returned together as
`field_errors` keyed by field name (`work_date`, `hours`, `earning_code_id`, `project_id`,
`task_id`, `description`). Unknown fields — including `employee_id`, week ids and `status` — are
rejected with 422; the owner is always the authenticated user.

`POST /time-entries` body:

```json
{ "work_date": "2026-10-21", "hours": "7.5", "earning_code_id": "uuid",
  "project_id": "uuid", "task_id": "uuid | null", "description": "Implementation work" }
```

Response `201` is the entry as shown in the week payload (including `version`).
The week row is created on first write if needed; a failed request creates nothing.

Rules (messages shown to users are the `field_errors` values):

- `hours`: > 0, ≤ configured maximum (default 24), at most two decimals; JSON string or number.
- `description`: trimmed, required, ≤ configured length (default 256); stored and rendered as text.
- `work_date`: valid date in 1970–2100; selects the week it belongs to.
- `project_id` / `earning_code_id`: must exist and be **active** for new entries.
- `task_id`: must belong to the project and be active. **Required when the project has active
  tasks**, not allowed for another project's task.
- The week must be `DRAFT` or `REJECTED`; otherwise `409 WEEK_NOT_EDITABLE` and nothing changes.

`PATCH /time-entries/{id}`: send any subset of the create fields (`task_id: null` clears the task)
plus an optional `version`. Rules differ from create in three ways: unchanged references to
retired projects/codes/tasks are accepted; the task-required rule applies only if the project or
task changes; `work_date` must stay inside the entry's existing week. A mismatching `version`
returns `409 STALE_ENTRY`. Sending identical values is a no-op (`version` and audit unchanged).
An empty body is `422` (`field_errors.request`).

`DELETE /time-entries/{id}` returns `204`; the audit event records the deleted entry's ids, date
and hours. Each successful write appends a row to `time_entry_events` in the same transaction.

## Batch creation (Phase 4, Week mode)

`POST /time-entries/batch`

```json
{ "entries": [
  { "work_date": "2026-10-19", "hours": "8",   "earning_code_id": "uuid", "project_id": "uuid", "task_id": "uuid", "description": "Sprint work" },
  { "work_date": "2026-10-20", "hours": "7.5", "earning_code_id": "uuid", "project_id": "uuid", "task_id": "uuid", "description": "Sprint work" }
] }
```

- **Atomic:** all items are validated first; nothing is written unless every item is valid, and the
  inserts (plus one audit event per entry) share one transaction. A failure at any point leaves no
  entries, no audit rows and no new week row.
- 1–31 items; every date in the **same week** (the first valid item defines it); each date **once**;
  unknown fields (including `employee_id`) are rejected at both levels.
- Each item obeys the same rules as `POST /time-entries` (active references, task rules, hour and
  description limits). The week must be `DRAFT` or `REJECTED`, otherwise `409 WEEK_NOT_EDITABLE`.
- It only adds entries: existing entries for the same dates are left untouched.
- Errors are addressed to the item: `422` with `field_errors` such as
  `{"entries.2.hours": "Hours cannot exceed 24 per entry.", "entries.3.work_date": "Each date can only appear once in a batch."}`.
  Several items can fail at once and all are reported.

`201` response:

```json
{ "entries": [ /* created entries, in request order, each with its own id */ ],
  "summary": { "total_hours": "15.50", "capped_hours": "15.50", "non_capped_hours": "0.00",
               "entry_count": 2, "draft_count": 2 },
  "daily_totals": [ { "date": "2026-10-19", "hours": "8.00" } ] }
```

## Submission (Phase 5)

`POST /timesheets/weeks/{date}/submit` — body optional: `{ "comment": "text up to 500 chars" | null }`;
optional header `Idempotency-Key: <8–100 of A–Z a–z 0–9 _ ->`. `{date}` is any date in the week (normalised
to the week start). The week is always the caller's own; no employee id exists in the request.

Success `200`: the updated week (same shape as `GET /timesheets/weeks/{date}`) with
`status: "SUBMITTED"`, `submitted_at`, `is_editable: false`, `draft_count: 0`.

In one transaction it: locks the week, checks the state, re-validates entries and the optional weekly
policy, sets the status and `submitted_at`, clears the previous review fields, appends a `SUBMITTED`
approval event (with the comment), enqueues a `TIMESHEET_SUBMITTED` notification, and records the
idempotency key. Notification delivery happens afterwards and cannot fail the request.

| Situation | Response |
| --- | --- |
| No week or no entries | `422 BUSINESS_RULE_VIOLATION`, `field_errors.entries`; no week row is created |
| A stored entry violates today's limits | `422`, `field_errors["entries.<entry id>.<field>"]` |
| Optional policy exceeded | `422`, `field_errors["day.<YYYY-MM-DD>"]` and/or `field_errors.week` (only if `MAX_HOURS_PER_DAY` / `MAX_HOURS_PER_WEEK` are set) |
| Week is SUBMITTED or APPROVED | `409 INVALID_TRANSITION` (nothing changes) |
| Same `Idempotency-Key` + same week again | `200` with the current week; no second event or notification |
| Same key, different week | `422`, `field_errors["Idempotency-Key"]` |
| Malformed key / unknown body field / comment > 500 | `422` |
| Concurrent submits without a key | exactly one `200`; the others `409` |

Resubmitting a REJECTED week is allowed and behaves the same, setting `resubmission: true` in the
notification payload. After a successful submission every write to the week returns
`409 WEEK_NOT_EDITABLE`.

Notification payload (outbox `payload`, ids and totals only): `week_id`, `employee_id`,
`manager_id` (may be null), `week_start_date`, `entry_count`, `total_hours`, `resubmission`.

## Manager review (Phase 6)

Every `/approvals` route requires the **manager** or **admin** role (employees get `403`). Within that,
a manager sees only employees whose `manager_id` is them; an admin sees everyone; nobody sees their own
weeks here (see decisions D-51 to D-54).

`GET /approvals?status=SUBMITTED&week_start_date=2026-10-19&page=1&page_size=20`

- `status`: `SUBMITTED` (default), `APPROVED` or `REJECTED`. `DRAFT` is `422`: drafts are private.
- `week_start_date`: optional; any date in the week.
- `page` ≥ 1, `page_size` 1–100. Ordered oldest submission first.

```json
{ "items": [ { "week_id": "uuid",
               "employee": { "id": "uuid", "display_name": "Alex Employee", "email": "…" },
               "week_start_date": "2026-10-19", "week_end_date": "2026-10-25",
               "status": "SUBMITTED", "submitted_at": "…", "reviewed_at": null, "reviewer_name": null,
               "total_hours": "14.50", "entry_count": 2 } ],
  "page": 1, "page_size": 20, "total": 37 }
```

`GET /approvals/{week_id}` returns `{ employee, week, history }`: `week` has the same shape as
`GET /timesheets/weeks/{date}` (entries, summary, daily totals, `review_comment`, `reviewed_by_name`)
and `history` is the append-only trail, oldest first: `{ action, actor, comment, created_at }`.
Unknown, out-of-scope and draft weeks are the same `404`; your own week is `403`.

`POST /approvals/{week_id}/approve` — body optional `{ "comment": "≤ 500 chars" | null }`.
`POST /approvals/{week_id}/reject` — body `{ "comment": "reason" }`, required, at least 5 characters
after trimming and at most 1000 (otherwise `422`, `field_errors.comment`). Both accept an optional
`Idempotency-Key` header (same rules as submission) and return the updated detail.

| Situation | Response |
| --- | --- |
| Week not SUBMITTED (already decided, or back with the employee) | `409 INVALID_TRANSITION`, nothing changes |
| Out-of-scope manager / unknown id / draft | `404 NOT_FOUND` |
| Own week | `403 FORBIDDEN` |
| Two reviewers at once | exactly one `200`; the other `409` |
| Same key + same week again | `200` with the current detail; no second event |
| Body contains `status`, `reviewer_id`, … | `422` (unknown fields are refused) |

A decision, in one transaction: sets `status`, `reviewed_by`, `reviewed_at`, `review_comment`; appends
the `APPROVED`/`REJECTED` event with the actor and comment; enqueues `TIMESHEET_APPROVED` /
`TIMESHEET_REJECTED` for the employee (payload: `week_id`, `employee_id`, `reviewer_id`,
`week_start_date`, `decision` — never the reason). Afterwards the employee's week shows the decision,
`reviewed_by_name` and the reason; a rejected week is editable and can be resubmitted, an approved one
is final.

## Administration (Phase 7) — administrators only

Every route below is under `/admin`; anyone who is not an administrator gets 403 and an unauthenticated
caller 401 (enforced for every route by `test_security_regression.py`). Every change writes an audit row
in the same transaction. Lists are paginated (`page` ≥ 1, `page_size` 1–100, default 20) and return
`{items, page, page_size, total}`.

| Method & path | Notes |
| --- | --- |
| `GET /admin/users?search=&role=&active=&managers_only=` | `{id, email, display_name, role, is_active, manager:{id,display_name,email}\|null, report_count, must_change_password, created_at}`; `search` matches name or email |
| `POST /admin/users` `{email, display_name, role, manager_id?}` | 201 `{user, temporary_password}`; **the password is shown only in this response**; 409 `CONFLICT` for a taken email (`field_errors.email`) |
| `GET /admin/users/{id}` | one user; 404 if unknown |
| `PATCH /admin/users/{id}` `{display_name?, role?, manager_id?, is_active?}` | `manager_id: null` removes the manager. 422 with `field_errors` for: own role/deactivation, an inactive or non-manager manager, someone who would still have active reports (`is_active`/`role`); 409 `LAST_ADMIN` |
| `POST /admin/users/{id}/reset-password` | `{temporary_password}` once; the person is signed out everywhere and must change it; 422 for your own account |
| `GET/POST /admin/teams`, `GET/PATCH/DELETE /admin/teams/{id}` | `{id, name, member_count}` (+ `members:[{id,display_name,email}]` on one team); names unique ignoring case |
| `PUT /admin/teams/{id}/members` `{user_ids:[…]}` | replaces the member set; only existing, active people can be added (422 `user_ids`) |
| `GET /admin/projects?search=&active=` / `POST` / `GET,PATCH /admin/projects/{id}` | `{id, code, name, description, is_active, task_count}`; `POST` `{code, name, description?}` (code normalised to capitals, then immutable) |
| `GET,POST /admin/projects/{id}/tasks`, `PATCH /admin/tasks/{id}` | `{id, project_id, code, name, is_active}`; a project with an active task requires one on new entries |
| `GET,POST /admin/earning-codes`, `PATCH /admin/earning-codes/{id}` | `{id, code, name, classification, is_active, entry_count}`; 409 `CLASSIFICATION_LOCKED` when `entry_count > 0` and the classification changes |
| `GET /admin/policy` | `{max_hours_per_entry, max_hours_per_day\|null, max_hours_per_week\|null, description_max_length, source: "environment"\|"database", updated_at, updated_by_name, environment_defaults}` |
| `PUT /admin/policy` | same four values; 422 per field (`entry ≤ 24`, `entry ≤ daily limit`, `daily ≤ weekly`, ≤ 2 decimals). `DELETE` removes the override (back to the environment) |
| `GET /admin/audit?entity_type=&entity_id=` | newest first: `{id, created_at, actor, entity_type, entity_id, entity_label, action, details}`. `entity_label` and member lists are **current names** resolved at read time; stored rows hold ids only |

## Reports (Phase 7) — managers and administrators

`GET /reports/hours?date_from=&date_to=&group_by=employee|project|earning_code|week&status=…&employee_id=&project_id=&page=&page_size=`

Scope: a manager's assigned reports, an administrator everyone; employees 403. `status` may repeat
(`APPROVED` by default; `SUBMITTED`, `REJECTED` allowed; **drafts are never included**). `date_from ≤
date_to`, at most 366 days (422 otherwise). Response: `{group_by, date_from, date_to, statuses, items:[{key,
label, detail, total_hours, capped_hours, non_capped_hours, entry_count, employee_count}], totals, page,
page_size, total}`; `totals` cover **all** rows, not the page. Hours are exact decimal strings.

`GET /reports/hours.csv` takes the same filters (no paging, at most 100 000 rows) and returns
`text/csv` with columns `Group, Detail, Total hours, Capped hours, Non-capped hours, Entries, People` and a
final `Total` row. Cells that begin with `=`, `+`, `-`, `@`, TAB or CR are prefixed with `'`. Each export is
logged with who, grouping and dates (never contents).

## Not yet implemented

Delegation of approvals, multi-level approval, in-app notification inbox, SSO/MFA, report scheduling.
