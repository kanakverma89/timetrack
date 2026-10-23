# Implementation report — Phases 0–3

Date: 2026-10-23. Environment: macOS, Python 3.14.7, Node 26.7.0, Docker 29.7.2 with `postgres:16`.
Everything marked "ran" was executed in this environment; anything not listed was not run.

## Completed

- **Phase 0** — repository assessment (empty directory), `docs/implementation-plan.md`,
  `docs/architecture.md`, `docs/decisions.md`.
- **Phase 1** — monorepo, `compose.yaml` (PostgreSQL), `.env.example`, validated settings
  (production rejects placeholder secrets / wildcard or non-HTTPS CORS), JSON logging with request
  ids, uniform error envelope, health endpoints, spec §7 schema + Alembic migrations, idempotent
  synthetic seed, local email/password auth (Argon2id, server-side sessions in an HttpOnly cookie,
  CSRF guard, login throttle, role dependency), CI workflow file, `dev-up`/`dev-down` scripts and
  skills.
- **Phase 2** — reference-data and week read APIs; dashboard with sign-in, app shell, URL-addressable
  week navigator, seven daily cards, weekly summary, entries grouped by date, loading/empty/error/
  retry and read-only/rejected states.
- **Phase 3 (Day mode)** —
  - `POST/PATCH/DELETE /time-entries`: all field errors returned together; project/earning code
    must be active; task must belong to the project and is required when the project has active
    tasks; hours decimal-safe (0 < h ≤ 24, two places); description trimmed text; week locked
    (`SELECT … FOR UPDATE`) and required to be DRAFT/REJECTED (409 otherwise); foreign/unknown ids
    return 404; optional `version` for optimistic concurrency; unknown/owner fields rejected.
  - Append-only audit table `time_entry_events` (migration `0002`); descriptions are never copied.
  - UI: Add/Edit panel (accessible modal, searchable project combobox, task dependent on project,
    error summary with field links, live character count), discard-changes and delete confirmations,
    toast, totals refreshed from the API after every change; controls hidden for locked weeks.

## Verification (commands actually run, final state)

| Check | Result |
| --- | --- |
| `ruff check` / `ruff format --check` (backend) | pass / pass (64 files) |
| `mypy app scripts` (strict) | no issues in 63 files |
| `pytest` (backend, real PostgreSQL) | **192 passed**, 1 warning (Starlette deprecation notice about `httpx` in its test client) |
| `alembic upgrade head`, `alembic check` | applied; "No new upgrade operations detected" (round-trip down/up also covered by pytest) |
| `npm run lint`, `format:check`, `typecheck` | pass / pass / pass |
| `npm test` (Vitest) | **112 passed** in 9 files |
| `npm run build` | succeeds |
| `npx playwright test` — Chromium, Firefox, WebKit | **136 passed, 5 skipped**, identical in two consecutive full runs (skips: 3 optional screenshot captures, 2 WebKit keyboard-Tab tests) |
| Manual | desktop/mobile/rejected-week and panel (error and mobile) screenshots inspected |

Sanity checks that the tests can fail: removing the ownership filter was caught by
`test_cannot_touch_another_employees_entry`; breaking "clear task on project change" was caught by a
new test that asserts the submitted payload; removing the discard prompt and the disabled Save button
were each caught. Two mutations initially *survived* (stale task id hidden by a `<select>`, redundant
double-submit guard) and led to a better test.

## Defects found by this work (and fixed)

- Task-required rule blocked unrelated edits of older entries when the form re-sent unchanged
  fields (backend test) → rule now applies only if project/task actually change.
- Focus handling in the modal was wrong in three ways that unit tests could not see: React
  StrictMode's double effect stole focus back; stacked modals closing together restored focus to a
  removed element; Safari/WebKit focus `<main>`/`<body>` on click so the wrong opener was saved
  (found by E2E; see D-35).
- `FieldError` was declared inside a render function (lint) and the combobox synced state in an
  effect (lint); both restructured.
- Dev-environment scripts: pid capture and a pid-file lookup bug (see the earlier `dev-up` work).

## Not verified / known limitations

- **CI workflow was never run** (no GitHub access here); treat `.github/workflows/ci.yml` as unverified.
- Only Python 3.14 and Node 26 were exercised; declared minimums (3.12, Node 20) are untested.
- No Dockerfiles for backend/frontend; Compose provides only PostgreSQL.
- Not measured: performance targets (spec §4.2), real mobile devices, screen-reader behaviour
  (axe-core + keyboard tests only), browsers other than the three Playwright engines.
- WebKit Tab-order is not asserted (two tests skipped); keyboard activation and focus return are.
- Login throttling is in-process memory only (single worker).
- An entry's date cannot be moved into another week (D-28). There is no daily/weekly hour cap and no
  future-date rule, because no policy was specified.
- The audit table is written but has no read API or UI yet.
- The project combobox filters client-side over all active projects (D-37).
- Python dependency versions are lower-bounded in `pyproject.toml` (no lock file); the frontend has
  `package-lock.json`.

## Not implemented (by scope)

Week-mode batch entry and the Day/Week toggle (Phase 4); weekly submission, submit audit events and
notification adapter (Phase 5); manager approvals (Phase 6); administration and hardening (Phase 7).
Of spec §12.3, scenarios 10, 11 and 13 depend on those phases. See `docs/testing-strategy.md`.
