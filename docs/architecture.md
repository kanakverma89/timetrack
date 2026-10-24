# Architecture

TimeTrack is a **modular monolith**: one React SPA, one FastAPI service, one PostgreSQL database.

```
Browser (React + TS, Vite)
   │  JSON over HTTP, session cookie (HttpOnly, SameSite=Lax)
   ▼
FastAPI  ── middleware: request-id, security headers, CSRF guard, access log
   │
   ├─ api/v1 routers          thin: parse → call service → shape response
   ├─ security/               session lookup, current-user + role dependencies
   ├─ services/               business rules, week math, summaries, transactions
   ├─ repositories/           SQLAlchemy queries only
   └─ models/                 SQLAlchemy 2.x declarative models
   ▼
PostgreSQL 16  (Alembic-managed schema)
```

## Backend layering rules

- **Routers** never contain business logic; they depend on `get_db` and `get_current_user` and
  call a service.
- **Services** own rules and transaction boundaries. Pure functions (`services/weeks.py`,
  `services/summary.py`) have no database access and are unit-tested directly.
- **Repositories** return ORM objects; they do not commit.
- Reference-data reads (`projects`, `tasks`, `earning-codes`) call repositories directly from
  the router for now because there is no rule to apply yet (see decisions D-14).
- **Errors** are raised as `AppError` subclasses and rendered by one handler into
  `{"error": {code, message, field_errors, request_id}}`. Pydantic validation errors, unknown
  routes and unhandled exceptions use the same envelope. No stack traces leave the process.

## Authentication and authorization

- Local email + password. Passwords are hashed with Argon2id (`argon2-cffi`).
- Login creates a row in `auth_sessions` holding an **HMAC-SHA256 digest** (keyed with
  `SESSION_SECRET`) of a random 256-bit token. The raw token only exists in the cookie.
  Logout revokes the row; expired/revoked/inactive-user sessions are rejected.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/`. Nothing is kept in
  `localStorage`.
- **CSRF**: unsafe methods require a custom `X-Requested-With: timetrack` header (cannot be set
  cross-site without a CORS preflight, and CORS is restricted to configured origins) and, when
  an `Origin` header is present, it must be an allowed origin.
- **Login rate limiting**: in-process sliding window keyed by client address + email.
  Single-process only; replace with a shared store before running multiple workers.
- **Authorization** is deny-by-default: every private route depends on `get_current_user`;
  `require_roles(...)` is available for manager/admin routes. The employee identity always comes
  from the session, never from the request body or path.

## Data model

Defined in `app/models/`, migrated by `backend/alembic/versions/`. See `docs/data-model.md`.
Highlights: UUID primary keys, `NUMERIC(5,2)` hours, composite foreign keys that make the
database reject a time entry whose employee differs from its week's owner or whose task does not
belong to its project, `CHECK` constraints on enums/hours/description, no cascading deletes on
audit data.

## Time and dates

- Business dates (`work_date`, `week_start_date`) are plain `date` values interpreted in
  `BUSINESS_TIMEZONE`. Event timestamps are UTC `timestamptz`.
- "Today" and "current week" are computed **on the server** in the business timezone and exposed
  via `GET /meta`; the browser never derives a business date from its own clock.
- Week start is configurable (`WEEK_START_DAY`, default Monday). The week endpoint normalises any
  date to its containing week.

## Frontend

- Vite + React 19 + TypeScript (strict). React Router for `/login` and `/` (dashboard).
- TanStack Query for server state (caching, retry, de-duplication). No global client store.
- All HTTP goes through `src/api/client.ts`; components never call `fetch`.
- Feature folders: `features/auth`, `features/dashboard`. Shared UI in `components/`.
- Hours are handled as **decimal strings** from the API and never summed in floating point on
  the client; the server is the single source of aggregate numbers.
- Plain CSS with design tokens (`styles/tokens.css`); no component library (see D-9).
- Dev server proxies `/api` to the backend, so the session cookie is same-origin in development.

## Submission and notifications

`services/submission_service.py` performs the DRAFT/REJECTED → SUBMITTED transition (see decisions
D-43 to D-48). Business code never calls a delivery provider: it writes a `notification_outbox` row
inside the same transaction as the change. After the response, a FastAPI background task runs
`notifications.process_pending`, which claims rows with `FOR UPDATE SKIP LOCKED` and passes them to
a `NotificationPort` (`app.state.notification_port`; the development adapter writes a structured log
line with identifiers only). Real providers implement the same one-method port. Phase 6 adds manager
endpoints guarded by `require_roles(MANAGER, ADMIN)` plus team/manager assignment checks.

## Environments

| Environment | Database | Purpose |
| --- | --- | --- |
| development | `timetrack` | Manual use, seeded with synthetic data |
| test | `timetrack_test` | pytest; dropped, recreated and migrated each session |
| e2e | `timetrack_e2e` | Playwright; reset and seeded on every run |

Scripts refuse to drop any database whose name does not end in `_test` or `_e2e`.
