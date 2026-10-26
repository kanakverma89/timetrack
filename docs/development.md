# Development guide

Everything you need to run, check and troubleshoot TimeTrack locally. For what the product is, see the
[README](../README.md); for the full specification see [`spec.md`](../spec.md).

## Prerequisites

- Docker (for PostgreSQL 16), Python ≥ 3.12, Node ≥ 22.22 (22, 24 or 26; `frontend/.nvmrc` pins 22).
  Older Node is refused at `npm ci` because the test tooling (Vitest 5, jsdom 30) needs it.
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
| `employee@example.test` | Employee (Alex; has sample weeks) |
| `employee2@example.test` | Employee (isolation checks) |
| `manager@example.test` | Manager (Morgan) — reviews `employee@` and `employee2@` |
| `manager2@example.test` | Manager (Riley) — reviews only `employee3@` |
| `employee3@example.test` | Employee (Taylor), reports to Riley |
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
| Dependency audit | `backend$ .venv/bin/pip install pip-audit && .venv/bin/pip-audit --skip-editable` and `frontend$ npm audit` (also a weekly workflow) |
| Backup/restore drill | `scripts/backup-restore-drill.sh` (dump, restore to a throwaway database, compare) |
| Performance (p95 vs 500 ms) | `backend$ .venv/bin/python scripts/perf_check.py` (see `performance.md`) |
| E2E (all browsers) | `frontend$ npm run test:e2e` — add `-- --project=chromium` for one browser |

Backend tests and E2E need `DATABASE_URL`/`SEED_PASSWORD` exported (or a root `.env`; Playwright
loads it automatically). E2E recreates and seeds the disposable `timetrack_e2e` database on every
run. Destructive helpers only accept database names ending in `_test` or `_e2e`.
First-time Playwright setup: `cd frontend && npx playwright install chromium firefox webkit`.

## Running it for real

[`operations.md`](operations.md) covers deployment (`compose.prod.yaml`: database, one-shot
migrations, API, nginx), configuration, creating the first administrator, backups and restore,
retention (`backend/scripts/maintain.py purge | anonymise-user | create-admin`) and known limits.
There is no default account in production; sign-in for the seeded development accounts uses
`SEED_PASSWORD`, which the seed refuses to use in production.

Administrators manage people, teams, projects and tasks, earning codes and the hour policy under
**Admin**, and read the **Audit log**; managers and administrators use **Reports** (CSV export).

## Free-tier demo deployment (optional)

To publish a portfolio demo for free (Vercel for the frontend, Render for the API, Neon for PostgreSQL) follow
[`deployment-free-tier.md`](deployment-free-tier.md): architecture, free-tier limits, environment
variables, step-by-step provider setup, a first-deployment check, smoke tests (`deploy-verify` workflow),
rollback and troubleshooting. The live demo linked from the README runs this setup; the first visit after idle takes about a
minute on the free tiers.

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
