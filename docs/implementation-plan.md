# Implementation plan

Scope so far: **Phases 0–5** from `spec.md` (discovery, foundation, Employee Dashboard read APIs,
Day-mode entry create/edit/delete, Week-mode batch entry, and weekly submission). Phases 6–7 are
designed for but not implemented.

## 1. Repository assessment (Phase 0)

| Item | Finding |
| --- | --- |
| Starting state | Empty directory, not a Git repository. Nothing to preserve or migrate. |
| Existing frontend/backend/tests/Docker/CI | None. Everything is created from the structure in spec §5. |
| Node / npm | v26.7.0 / 11.19.0 |
| Python | 3.14.7 (system). Project declares `requires-python >=3.12`. |
| Docker | 29.7.2, daemon running, `postgres:16` image already cached locally. |
| PostgreSQL | No local server binaries; PostgreSQL runs via Docker Compose (`postgres:16`). |
| Playwright | Browsers cached under `~/Library/Caches/ms-playwright`; Playwright package installed per project. |
| Free ports used | 5432 (db), 8000 (api dev), 5173 (web dev), 8100/5174 (e2e) |
| Unrelated local containers | ERPNext/MariaDB containers exist on the machine. They are not touched; the project's compose stack uses its own project name and container names. |

Project root = this directory. `spec.md` is a copy of the supplied specification.

## 2. Toolchain and run commands

All commands are from the repository root unless noted. Full details live in `README.md`.

| Purpose | Command |
| --- | --- |
| Start database | `docker compose up -d --wait db` |
| Backend install | `cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"` |
| Migrate | `cd backend && .venv/bin/alembic upgrade head` |
| Seed (synthetic) | `cd backend && .venv/bin/python scripts/seed.py --sample-entries` |
| Run API | `cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000` |
| Backend lint / types | `.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy app scripts` |
| Backend tests | `cd backend && .venv/bin/pytest` |
| Frontend install | `cd frontend && npm ci` |
| Run web | `cd frontend && npm run dev` |
| Frontend lint / types / unit | `npm run lint && npm run format:check && npm run typecheck && npm test` |
| Frontend build | `npm run build` |
| E2E | `cd frontend && npm run test:e2e` |

## 3. Milestones

### Phase 0 — discovery and planning  ✅ (this document, `architecture.md`, `decisions.md`)

### Phase 1 — foundation

- [x] Monorepo skeleton, `.gitignore`, `.env.example`, `compose.yaml`
- [x] Backend: settings with production validation, SQLAlchemy session management, request-id +
      structured JSON logging, consistent error envelope, health endpoints
- [x] Full schema (spec §7) as SQLAlchemy models + one Alembic migration, verified from an empty DB
- [x] Local email/password auth: Argon2id hashes, server-side sessions in an HttpOnly cookie,
      CSRF guard, login rate limit, role-aware authorization dependency
- [x] Synthetic, idempotent seed script
- [x] Frontend skeleton (Vite, React, TS, ESLint, Prettier, Vitest), typed API client
- [x] CI workflow (`.github/workflows/ci.yml`; not executed here — see report)

### Phase 2 — Employee Dashboard and read APIs

- [x] `GET /meta`, `GET /projects`, `GET /projects/{id}/tasks`, `GET /earning-codes`,
      `GET /timesheets/weeks/{date}`
- [x] Dashboard: app shell, login, week navigator (URL-addressable `?week=`), seven daily cards,
      weekly summary, status badge, entries grouped by date, loading/empty/error/retry states
- [x] Backend unit + API tests, frontend unit tests, Playwright scenarios for Phase 2

### Phase 3 — Day-mode time entry

- [x] `POST/PATCH/DELETE /time-entries` with full server-side validation, ownership (404), week
      locking, optimistic concurrency, audit table (migration `0002`)
- [x] Add/Edit panel (accessible modal, project combobox, task dependent on project, error summary),
      discard and delete confirmations, toast, totals refreshed from the API
- [x] Backend, component and Playwright coverage (see `docs/testing-strategy.md`)

### Phase 4 — Week-mode batch entry

- [x] `POST /time-entries/batch`: atomic, validated per item, one week, one entry per date
- [x] Day/Week toggle, per-day grid with enable/disable, exact live total, per-day errors,
      "already logged" hints; Day/Week state preserved when switching
- [x] Backend, component and Playwright coverage (spec scenarios 10–11)

### Phase 5 — Weekly submission

- [x] `POST /timesheets/weeks/{date}/submit`: one transaction, row lock, state check, re-validation,
      optional weekly policy, approval event, notification outbox, idempotency key
- [x] Notification port + outbox processor (background, retries, parked failures)
- [x] Submit button, confirmation dialog with optional comment, readable errors, read-only afterwards
- [x] Backend, component and Playwright coverage (spec scenarios 13–14)

### Explicitly not yet implemented

Phase 6 (manager approvals), Phase 7 (administration/hardening). The schema, auth roles, audit
tables and notification outbox they need already exist, but there are no endpoints or UI for them
(except the entry audit table, which is now written by Phase 3).

## 4. Affected areas

New files only (empty starting point):

- `docs/`, `README.md`, `.env.example`, `compose.yaml`, `.github/workflows/ci.yml`
- `backend/` — `app/{core,api,models,schemas,repositories,services,security,tests}`, `alembic/`, `scripts/`
- `frontend/` — `src/{app,api,components,features,hooks,types,utils,styles}`, `tests/e2e`

## 5. Verification approach

Each layer is verified with the command listed in §2 and the actual results are recorded in the
final implementation report (`docs/implementation-report.md`). Nothing is marked complete there
unless the corresponding command was run.
