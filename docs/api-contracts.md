# API contracts (implemented in Phases 1–3)

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
| 403 | `FORBIDDEN` | missing CSRF header, disallowed `Origin`, insufficient role |
| 409 | `WEEK_NOT_EDITABLE` / `STALE_ENTRY` | the week is submitted/approved; the entry's `version` no longer matches |
| 404 | `NOT_FOUND` | unknown route or resource; **also another employee's entry** (indistinguishable from missing) |
| 405 | `METHOD_NOT_ALLOWED` | |
| 422 | `VALIDATION_ERROR` | malformed input; week date outside 1970–2100 |
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
| `GET /auth/me` | session | `{id, email, display_name, role}` |
| `GET /meta` | session | `{app_name, business_timezone, week_start_day, today, current_week_start_date, max_hours_per_entry, description_max_length}` — `today` is the business date computed on the server |
| `GET /projects?active=true&search=` | session | `{items:[{id, code, name, is_active}]}`; `search` matches code or name, case-insensitive, ≤ 100 chars, wildcards literal |
| `GET /projects/{id}/tasks?active=true` | session | `{items:[{id, project_id, code, name, is_active}]}`; 404 for unknown project |
| `GET /earning-codes?active=true` | session | `{items:[{id, code, name, classification, is_active}]}` |
| `GET /timesheets/weeks/{date}` | session | The caller's week containing `date` (normalised to the week start) |
| `POST /time-entries` | session + CSRF | Create an entry (201) |
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

## Not yet implemented

`POST /time-entries/batch` (Week mode), `POST /timesheets/weeks/{date}/submit`, manager
`/approvals/*` (spec §8.5–8.7).
