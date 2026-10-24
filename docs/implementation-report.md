# Implementation report — Phases 0–5

Date: 2026-10-24. Local environment: macOS, Python 3.14.7, Node 26.7.0, Docker 29.7.2 with
`postgres:16`. CI: GitHub Actions on `ubuntu-24.04`. Everything marked "ran" was executed; anything
not listed was not run.

## Completed

- **Phase 0** — repository assessment (empty directory), plan, architecture and decision log.
- **Phase 1** — monorepo, `compose.yaml` (PostgreSQL), validated settings, JSON logging with request
  ids, uniform error envelope, health endpoints, spec §7 schema + Alembic migrations, idempotent
  synthetic seed, local email/password auth (Argon2id, server-side sessions in an HttpOnly cookie,
  CSRF guard, login throttle, role dependency), CI, `dev-up`/`dev-down` scripts and skills.
- **Phase 2** — reference-data and week read APIs; dashboard with week navigation, daily cards,
  weekly summary, entries grouped by date, loading/empty/error/retry and read-only/rejected states.
- **Phase 3** — Day-mode entry create/edit/delete: server-side validation, ownership (404), week
  locking, optimistic concurrency, append-only audit; accessible panel, project combobox, confirms.
- **Phase 4** — Week-mode batch entry: atomic `POST /time-entries/batch`, per-day grid, exact
  decimal live total, per-day errors mapped back to the right day, Day/Week state preserved.
- **Phase 5 (weekly submission)** —
  - `POST /timesheets/weeks/{date}/submit`: one transaction under a row lock that checks the state
    (DRAFT/REJECTED only), re-validates stored entries against current limits and the optional
    configured policy (`MAX_HOURS_PER_DAY`/`MAX_HOURS_PER_WEEK`, unset by default), sets
    `SUBMITTED` + `submitted_at`, appends the audit event, enqueues the manager notification and
    records the idempotency key. Any failure changes nothing.
  - Duplicate safety: concurrent submits give exactly one transition; an optional `Idempotency-Key`
    turns a retry into a success instead of a conflict.
  - Notifications: outbox + `NotificationPort`; delivery runs after the response with
    `FOR UPDATE SKIP LOCKED`, bounded retries and recorded errors, and cannot fail the request.
    Payloads and logs contain identifiers and totals only.
  - UI: Submit/Resubmit button (disabled with a reason on an empty week), confirmation dialog with
    summary and optional comment, readable per-entry/per-day errors, read-only week afterwards.

## Fixes made at the user's request in this session

| Item | Result |
| --- | --- |
| CI used deprecated Node 20 actions; `ubuntu-latest` was migrating | actions bumped to the v7 releases (verified to declare `node24`), runner pinned to `ubuntu-24.04`; CI annotations are gone |
| Node 20 "declared minimum" untested | tested in CI and **found false**: Vitest 5 / jsdom 30 need Node ≥ 22.22. Minimum corrected to 22.22 (`engines`, `engine-strict`, `.nvmrc`); CI matrix now Python 3.12/3.14 and Node 22/24/26 |
| Performance unmeasured | `backend/scripts/perf_check.py` + `docs/performance.md`: dashboard p95 ≈ 7 ms, save ≈ 11–13 ms, submit ≈ 11–14 ms against the 500 ms target (single machine, ~15k entries) |
| Screen-reader behaviour untested | **not fixed — cannot be**: it needs a person using real assistive technology (VoiceOver/NVDA/JAWS). Automated axe checks and keyboard tests cover what a machine can |
| Manager approvals and admin not built | Phases 6 and 7; not started |

## Verification (commands actually run, final state)

| Check | Result |
| --- | --- |
| `ruff check` / `ruff format --check` (backend) | pass / pass (73 files) |
| `mypy app scripts` (strict) | no issues in 72 files |
| `pytest` (backend, real PostgreSQL) | **255 passed**, 1 warning (Starlette deprecation notice about `httpx` in its test client) |
| `alembic upgrade head`, `alembic check` | applied; "No new upgrade operations detected" |
| `npm run lint`, `format:check`, `typecheck` | pass / pass / pass |
| `npm test` (Vitest) | **157 passed** in 12 files |
| `npm run build` | succeeds |
| `npx playwright test` — Chromium, Firefox, WebKit, local | **207 passed, 6 skipped**, identical in two consecutive full runs (skips: 3 optional screenshot captures, 3 WebKit keyboard-Tab tests) |
| `scripts/perf_check.py` (two runs) | every p95 far under 500 ms (see `docs/performance.md`) |
| GitHub Actions on the Phase 5 branch | **all jobs green**: backend on Python 3.12 and 3.14, frontend on Node 22, 24 and 26, and the E2E job (full Playwright suite, three browsers) |

Mutation checks (change the code, confirm a test fails) for Phase 5: removing the row lock, the
status check, the audit event, the idempotency lookup, and the weekly policy (backend); a fresh key
per attempt, the button on locked weeks, an untrimmed comment, the in-flight guard, and focus moving
to the error (frontend). All were caught.

## Defects found by this work (and fixed)

- Phase 3: the task-required rule blocked unrelated edits of older entries; three modal focus bugs
  (React StrictMode, stacked modals, Safari/WebKit) found by Playwright.
- Phase 5, both found by end-to-end tests that unit tests could not see:
  - a double click sent **two** submit requests (React had not yet disabled the button); the server
    handled it safely thanks to the idempotency key, but the UI now also blocks it with a
    synchronous in-flight guard, applied to Save, Delete and Submit;
  - after a failed action the focused button had been disabled, dropping focus to `<body>`, so
    keyboard users lost their place and Escape stopped working; focus now moves to the error.
- Node 20 support was claimed but false (see above).
- Test-side mistakes worth recording honestly: I once killed the servers of a Playwright run I had
  wrongly believed was dead (the run was invalidated and redone), and one mutation reverted only
  two of three files (caught immediately by the "restored" run).

## Not verified / known limitations

- Screen readers, real mobile devices, performance beyond one machine, other browsers.
- WebKit Tab-order is not asserted (three tests skipped); activation and focus return are.
- No Dockerfiles for backend/frontend; Compose provides only PostgreSQL.
- Login throttling is in-process memory only. Idempotency keys are never expired. Outbox rows left
  in `PROCESSING` by a crash are not recovered. The notification adapter only logs; no real
  provider exists.
- An entry's date cannot be moved into another week (D-28). The weekly policy is checked only at
  submission, not when entries are written.
- The audit tables (`time_entry_events`, `approval_events`) are written but have no read API or UI.
- Python dependencies are lower-bounded (no lock file); the frontend has `package-lock.json`.
- The repository is private on GitHub; commits use the account's noreply address.

## Not implemented (by scope)

Manager approvals (Phase 6: pending list, approve/reject with a required reason, authorization by
assignment, employee notification) and administration/hardening (Phase 7). Every first-milestone
scenario in spec §12.3 is now covered.
