# API contracts (implemented in Phases 1–2)

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
| 404 | `NOT_FOUND` | unknown route or resource |
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
  "entries": [ { "id": "uuid", "work_date": "2026-10-19", "hours": "8.00", "description": "…",
                 "project": {"id": "…", "code": "…", "name": "…"},
                 "task": {"id": "…", "code": "…", "name": "…"} ,
                 "earning_code": {"id": "…", "code": "…", "name": "…", "classification": "CAPPED"} } ]
}
```

`daily_totals` always has seven entries. `capped_hours + non_capped_hours = total_hours`.
`draft_count` counts entries while the week is `DRAFT` or `REJECTED`, otherwise 0.

## Not yet implemented

`POST/PATCH/DELETE /time-entries`, `POST /time-entries/batch`, `POST /timesheets/weeks/{date}/submit`,
manager `/approvals/*` (spec §8.5–8.7).
