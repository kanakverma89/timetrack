# Implementation report — Phases 0–4

Date: 2026-10-24. Local environment: macOS, Python 3.14.7, Node 26.7.0, Docker 29.7.2 with
`postgres:16`. CI environment: GitHub Actions, Ubuntu, Python 3.12, Node 22, `postgres:16` service.
Everything marked "ran" was executed; anything not listed was not run.

## Completed

- **Phase 0** — repository assessment (empty directory), `docs/implementation-plan.md`,
  `docs/architecture.md`, `docs/decisions.md`.
- **Phase 1** — monorepo, `compose.yaml` (PostgreSQL), `.env.example`, validated settings
  (production rejects placeholder secrets / wildcard or non-HTTPS CORS), JSON logging with request
  ids, uniform error envelope, health endpoints, spec §7 schema + Alembic migrations, idempotent
  synthetic seed, local email/password auth (Argon2id, server-side sessions in an HttpOnly cookie,
  CSRF guard, login throttle, role dependency), CI workflow, `dev-up`/`dev-down` scripts and skills.
- **Phase 2** — reference-data and week read APIs; dashboard with sign-in, app shell,
  URL-addressable week navigator, seven daily cards, weekly summary, entries grouped by date,
  loading/empty/error/retry and read-only/rejected states.
- **Phase 3 (Day mode)** — `POST/PATCH/DELETE /time-entries` with full server-side validation,
  ownership (404), week locking, optimistic concurrency and an append-only audit table; accessible
  Add/Edit panel, searchable project combobox, discard/delete confirmations, toast.
- **Phase 4 (Week mode)** —
  - `POST /time-entries/batch`: 1–31 items, one week, each date once; every item validated before
    anything is written; all rows and audit events in one transaction (verified by forcing a
    failure part-way through); per-item error addressing (`entries.<i>.<field>`); never replaces
    existing entries; returns the entries plus the recomputed summary and daily totals.
  - UI: Day/Week toggle (add only), a seven-row grid with per-day enable/disable, exact decimal live
    total, "already logged" hints, per-day errors with links from the summary, server errors mapped
    back to the correct day, and separate Day/Week state so switching modes loses nothing.

## Verification (commands actually run, final state)

| Check | Result |
| --- | --- |
| `ruff check` / `ruff format --check` (backend) | pass / pass (66 files) |
| `mypy app scripts` (strict) | no issues in 65 files |
| `pytest` (backend, real PostgreSQL) | **217 passed**, 1 warning (Starlette deprecation notice about `httpx` in its test client) |
| `alembic upgrade head`, `alembic check` | applied; "No new upgrade operations detected" |
| `npm run lint`, `format:check`, `typecheck` | pass / pass / pass |
| `npm test` (Vitest) | **134 passed** in 9 files |
| `npm run build` | succeeds |
| `npx playwright test` — Chromium, Firefox, WebKit, local | **171 passed, 6 skipped**, identical in two consecutive full runs (skips: 3 optional screenshot captures, 3 WebKit keyboard-Tab tests) |
| GitHub Actions on `main` (Phase 3 merge) and on the Phase 4 branch | **backend, frontend and e2e jobs all succeeded** in both runs, on Ubuntu with Python 3.12 / Node 22 (e2e = the full Playwright suite on all three browsers) |
| Manual | desktop/mobile screenshots of the dashboard, the Day panel (errors) and the Week grid (errors, mobile) inspected |

Mutation checks (change the code, confirm a test fails): removing the owner filter; per-row commits
in the batch; "clear task on project change"; the discard prompt; the disabled Save button;
mapping a batch error to the wrong day; sending zero-hour days; counting unchecked days in the
total. All were caught. Two earlier mutations initially survived and led to better tests (a stale
task id hidden by a `<select>`; a redundant double-submit guard).

## Defects found by this work (and fixed)

- Phase 3: task-required rule blocked unrelated edits of older entries (found by a backend test);
  three modal focus bugs invisible to unit tests — React StrictMode's double effect, stacked modals
  restoring focus to a removed element, and Safari/WebKit focusing `<main>`/`<body>` on click
  (found by Playwright; see D-35).
- Phase 4: no application defects surfaced beyond test-side mistakes (wrong expectations, a focus
  race in a test, a mutation I forgot to revert, a reused variable caught by mypy). Design points
  that tests forced into the open: a batch must be validated entirely before any write and must
  refuse duplicate dates and mixed weeks; errors must be addressed by item index and mapped back to
  the *day*, not the list position.

## Not verified / known limitations

- Node 20 (the declared minimum) is untested; Python 3.12 and Node 22 pass in CI.
- CI reports two non-blocking warnings: the pinned actions (`checkout@v4`, `setup-node@v4`,
  `setup-python@v5`) target the deprecated Node 20 runtime, and `ubuntu-latest` is migrating to
  Ubuntu 26. The workflow should be updated to newer action versions.
- No Dockerfiles for backend/frontend; Compose provides only PostgreSQL.
- Not measured: performance targets (spec §4.2), real mobile devices, screen-reader behaviour
  (axe-core + keyboard tests only), browsers other than the three Playwright engines.
- WebKit Tab-order is not asserted (three tests skipped); activation and focus return are.
- Login throttling is in-process memory only (single worker).
- An entry's date cannot be moved into another week (D-28). There is no daily/weekly hour cap and no
  future-date rule, because no policy was specified; the 24-hour limit applies per entry/day row.
- The audit table is written but has no read API or UI yet.
- The project combobox filters client-side over all active projects (D-37).
- Python dependency versions are lower-bounded in `pyproject.toml` (no lock file); the frontend has
  `package-lock.json`.
- The repository is private on GitHub; commits are authored with the account's noreply address.

## Not implemented (by scope)

Weekly submission, submit audit events and the notification adapter (Phase 5); manager approvals
(Phase 6); administration and hardening (Phase 7). Of spec §12.3, scenario 13 (submit a valid week)
depends on Phase 5; every other first-milestone scenario is covered. See `docs/testing-strategy.md`.
