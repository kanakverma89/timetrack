# Implementation report — Phases 0–2

Date: 2026-10-23. Environment: macOS, Python 3.14.7, Node 26.7.0, Docker 29.7.2 with `postgres:16`.
Everything below marked "ran" was executed in this environment; anything not listed was not run.

## Completed

- **Phase 0** — repository assessment (empty directory), `docs/implementation-plan.md`,
  `docs/architecture.md`, `docs/decisions.md`.
- **Phase 1** — monorepo, `compose.yaml` (PostgreSQL), `.env.example`, validated settings
  (production rejects placeholder secrets / wildcard or non-HTTPS CORS), JSON logging with request
  ids, uniform error envelope, health endpoints, full spec §7 schema + one Alembic migration,
  idempotent synthetic seed, local email/password auth (Argon2id, server-side sessions in an
  HttpOnly cookie, CSRF guard, login throttle, role dependency), CI workflow file.
- **Phase 2** — `GET /meta`, `/projects`, `/projects/{id}/tasks`, `/earning-codes`,
  `/timesheets/weeks/{date}`; React app with sign-in, app shell, week navigator (URL-addressable
  `?week=`), seven daily cards, weekly summary, entries grouped by date, loading/empty/error/retry,
  read-only and rejected banners, live-region announcements. All figures come from the API and
  PostgreSQL; nothing is hard-coded in components.

## Verification (commands actually run, final state)

| Check | Result |
| --- | --- |
| `ruff check .` / `ruff format --check .` (backend) | pass / pass (59 files) |
| `mypy app scripts` (strict) | no issues in 58 files |
| `pytest` (backend, real PostgreSQL) | **129 passed**, 1 warning (Starlette deprecation notice about `httpx` in its test client) |
| `alembic upgrade head`, `alembic check`, downgrade→base→upgrade | applied; "No new upgrade operations detected"; round-trip passes (also exercised by pytest) |
| `npm run lint`, `format:check`, `typecheck` (frontend) | pass / pass / pass |
| `npm test` (Vitest) | **60 passed** in 6 files |
| `npm run build` | succeeds (JS 309 kB, 97 kB gzip) |
| `npx playwright test` — Chromium, Firefox, WebKit | **72 passed, 3 skipped** (25 specs × 3 engines; the skipped spec only captures screenshots when `E2E_SCREENSHOT_DIR` is set) |
| Manual smoke | curl against the live API (login, cookie flags, week payload, CSRF/401/422 cases); desktop, mobile and rejected-week screenshots inspected visually |
| Secret scan | generated `.env` values do not appear in any other file; `.env` is git-ignored |

Sanity checks that the tests can fail: a deliberate off-by-one in week navigation was caught by a
Vitest test; lint and typecheck were shown to flag an injected error. Test-design bugs found and
fixed along the way: a test mocked one 5xx while the client (correctly) retries, and a request-count
mock was unreliable under React StrictMode.

## Not verified / known limitations

- **CI workflow was never run** (no GitHub access here); treat `.github/workflows/ci.yml` as unverified.
- Only Python 3.14 and Node 26 were exercised; the declared minimums (3.12, Node 20) are untested.
- No Dockerfiles for backend/frontend; Compose provides only PostgreSQL.
- Not measured: performance targets (spec §4.2), real mobile devices, screen-reader behaviour
  (only axe-core + keyboard tests), browsers other than the three Playwright engines.
- WebKit Tab-order is not asserted (engine/OS behaviour); keyboard activation is.
- Login throttling is in-process memory only (single worker).
- "Work date inside week" and week-start-day consistency will be service-layer rules in Phase 3;
  the database enforces the other integrity rules (see `docs/data-model.md`).
- No git repository was initialised, so there is no commit history or `git status` to report.
- Python dependency versions are lower-bounded in `pyproject.toml` (no lock file); the frontend has
  `package-lock.json`.

## Not implemented (by scope)

Add/edit/delete time entries and the entry panel (Phase 3), Week-mode batch (Phase 4), submission,
audit events and notification adapter (Phase 5), manager approvals (Phase 6), administration and
hardening (Phase 7). Of spec §12.3, scenarios 3–11, 13 and 14 (except read-only display of a seeded
submitted week) depend on these phases; 15 is only partially applicable. See
`docs/testing-strategy.md`.
