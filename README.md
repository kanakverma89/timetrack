# TimeTrack — timesheet management

Independent, neutral-branded weekly timesheet application. React + TypeScript (Vite) frontend,
FastAPI backend, PostgreSQL, Playwright end-to-end tests. See [`spec.md`](spec.md) for the full
specification and [`docs/implementation-report.md`](docs/implementation-report.md) for what is
built and verified.

**Status:** Phases 0–3 (foundation, Employee Dashboard, Day-mode add/edit/delete of time entries).
Week-mode batch entry, weekly submission (Phases 4–5), manager approvals and administration are not
implemented yet.

## Prerequisites

- Docker (for PostgreSQL 16), Python ≥ 3.12, Node ≥ 20
- Free ports: 5432 (database), 8000 (API), 5173 (web); 8100/5174 for E2E runs

## Setup

```bash
cp .env.example .env          # then replace every placeholder (see comments in the file)
docker compose up -d --wait db

cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
set -a && . ../.env && set +a  # export settings for the commands below
.venv/bin/alembic upgrade head
.venv/bin/python scripts/seed.py --sample-entries

cd ../frontend && npm ci
```

`.env` is git-ignored. The seed script requires `SEED_PASSWORD` (≥ 12 characters) and refuses to
run when `APP_ENV=production`.

## Run

One command (after the setup above): `scripts/dev-up.sh` starts the database, migrations, API and
web app in the background; `scripts/dev-down.sh` stops them (data is kept). In Claude Code these
are the `/dev-up` and `/dev-down` skills. Logs are written to `.dev/`. Or run the pieces by hand:

```bash
# terminal 1 — API (http://localhost:8000, docs at /api/v1/docs in development)
cd backend && set -a && . ../.env && set +a && .venv/bin/uvicorn app.main:app --reload --port 8000

# terminal 2 — web (http://localhost:5173, proxies /api to the API)
cd frontend && npm run dev
```

Seeded synthetic accounts (all share the password you set as `SEED_PASSWORD`):

| Email | Role |
| --- | --- |
| `employee@example.test` | Employee (has sample weeks) |
| `employee2@example.test` | Employee (isolation checks) |
| `manager@example.test` | Manager |
| `admin@example.test` | Admin |

Sample weeks for `employee@example.test` (Monday-first): `2026-10-19` (draft), `2026-10-12`
(draft), `2026-10-05` (submitted), `2026-09-28` (rejected). Open e.g.
`http://localhost:5173/?week=2026-10-19`.

## Checks

| What | Command (from the directory shown) |
| --- | --- |
| Backend lint | `backend$ .venv/bin/ruff check . && .venv/bin/ruff format --check .` |
| Backend types | `backend$ .venv/bin/mypy app scripts` |
| Backend tests | `backend$ .venv/bin/pytest` (creates/drops `timetrack_test`) |
| Migrations | `backend$ .venv/bin/alembic upgrade head && .venv/bin/alembic check` |
| Frontend lint/format/types | `frontend$ npm run lint && npm run format:check && npm run typecheck` |
| Frontend unit tests | `frontend$ npm test` |
| Frontend build | `frontend$ npm run build` |
| E2E (all browsers) | `frontend$ npm run test:e2e` — add `-- --project=chromium` for one browser |

Backend tests and E2E need `DATABASE_URL`/`SEED_PASSWORD` exported (or a root `.env`; Playwright
loads it automatically). E2E recreates and seeds the disposable `timetrack_e2e` database on every
run. Destructive helpers only accept database names ending in `_test` or `_e2e`.
First-time Playwright setup: `cd frontend && npx playwright install chromium firefox webkit`.

## Layout

```
backend/   FastAPI app (api → services → repositories → models), Alembic, scripts, tests
frontend/  React app (api client, features/, components/), Vitest tests, Playwright e2e
docs/      plan, architecture, decisions, data model, API contracts, testing, report
```

## Troubleshooting

- **`POSTGRES_PASSWORD` error from compose** — create `.env` from `.env.example` first.
- **Port 5432 in use** — set `DB_PORT` and the port in `DATABASE_URL`.
- **401 right after login in a custom setup** — the session cookie is `SameSite=Lax`; use the Vite
  proxy (same origin) or add your web origin to `CORS_ORIGINS`.
- **429 on login** — five failed attempts per address+email per 15 minutes; restart the API to
  reset the in-memory counter in development.
- **Playwright "Executable doesn't exist"** — run the `playwright install` command above.
- **Alembic/pytest cannot connect** — export the environment (`set -a && . ../.env && set +a`).
