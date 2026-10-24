# Implementation report — Phases 0–6

Date: 2026-10-24. Local environment: macOS, Python 3.14.7, Node 26.7.0, Docker 29.7.2 with
`postgres:16`. CI: GitHub Actions on `ubuntu-24.04` (Python 3.12/3.14, Node 22/24/26). Everything
marked "ran" was executed; anything not listed was not run.

## Completed

- **Phases 0–5** — foundation, Employee Dashboard, Day- and Week-mode time entry, weekly submission
  (see `docs/decisions.md` D-1 to D-50 for every design choice and the earlier report history).
- **Phase 6 (manager approvals)** —
  - **API:** `GET /approvals` (paginated, filter by status and week, oldest submission first),
    `GET /approvals/{id}` (employee, full week, append-only history), `POST …/approve`,
    `POST …/reject`.
  - **Authorization:** only an employee's *assigned* manager (`manager_id`) or an administrator may
    review; team membership grants nothing; nobody reviews their own week (403); out-of-scope, draft
    and unknown weeks are the same 404; employees get 403 on every route. One pure policy function
    defines it, is tested exhaustively, and a parity test keeps the SQL list scope identical to it.
  - **Decisions:** one transaction under the week's row lock: SUBMITTED-only (else 409), a
    meaningful rejection reason (≥ 5 characters), reviewer and time recorded, an append-only audit
    event, and an employee notification whose payload carries ids only (never the reason). Optional
    `Idempotency-Key`; racing reviewers produce exactly one decision.
  - **Audit:** migration 0004 makes `approval_events` and `time_entry_events` append-only with a
    database trigger, so even buggy code cannot rewrite history.
  - **UI:** an Approvals link with a count of weeks waiting (managers/admins only), a list with status
    and week filters and paging (a real table, labelled cards on phones), a review page (entries,
    employee's note, history) with approve/reject dialogs, and decision details (who, when, why) on the
    employee's dashboard. A rejected week is editable and can be resubmitted; an approved week is final.
  - **Seed:** a second manager (Riley) and a third employee (Taylor) make scope separation testable.

## Verification (commands actually run, final state)

| Check | Result |
| --- | --- |
| `ruff check` / `ruff format --check` (backend) | pass / pass (80 files) |
| `mypy app scripts` (strict) | no issues in 79 files |
| `pytest` (backend, real PostgreSQL) | **305 passed**, 1 warning (Starlette deprecation notice about `httpx` in its test client) |
| `alembic upgrade head`, `alembic check` | applied; "No new upgrade operations detected" (down/up round trip covered by pytest) |
| `npm run lint`, `format:check`, `typecheck` | pass / pass / pass |
| `npm test` (Vitest) | **186 passed** in 13 files |
| `npm run build` | succeeds |
| `npx playwright test` — Chromium, Firefox, WebKit, local | **248 passed, 7 skipped**, identical in two full runs (skips: 3 optional screenshot captures, 4 WebKit keyboard-Tab tests) |
| `scripts/perf_check.py` (two runs) | every p95 far under 500 ms, including the manager list (14–24 ms) and approve (11–12 ms); see `docs/performance.md` |
| GitHub Actions on the Phase 6 branch | **all jobs green**: backend on Python 3.12 and 3.14, frontend on Node 22, 24 and 26, and the E2E job (full Playwright suite on three browsers; about 10 minutes on the shared runner) |

Mutation checks for Phase 6 (change the code, confirm a test fails): removing the scope check, the
self-review check, the SUBMITTED-only check, the rejection-reason requirement, the row lock, the
audit event; leaking the reason into the notification payload (backend, all caught); skipping the
reason check, the role guard, the nav gating and the in-flight guard (frontend, all caught).

## Defects found by this work (and fixed)

- Accessibility, found by the component tests: the navigation link's accessible name read
  "Approvals3 waiting…" (whitespace between inline pieces is not a reliable separator), now an
  explicit `aria-label` that still contains the visible text; a row link was labelled "Review …"
  while its visible text said "View".
- Test-side mistakes worth recording honestly: a no-op expression I had written as if it were an
  assertion (caught by lint), two assertions that expected the wrong state, an unused-import
  placeholder test I removed rather than keep as padding.
- No application defect surfaced in the authorization or decision logic; the mutation checks above
  are the evidence that the tests would have caught one.

## Not verified / known limitations

- Screen readers (needs a person using real assistive technology), real mobile devices, performance
  beyond one machine and a very large organisation, other browsers than the three Playwright engines.
- WebKit Tab-order is not asserted (four tests skipped); activation and focus return are.
- Authorization is by direct assignment only. There is no delegation (a manager on leave), no
  multi-level approval and no admin UI to reassign `manager_id`; those belong to Phase 7 or later.
- The employee is notified only through the outbox/port (development adapter logs); there is no
  in-app inbox. Outbox rows left in `PROCESSING` by a crash are not recovered. Idempotency keys are
  never expired.
- The audit trails are written and shown on the review page but there is no cross-week audit report.
- A database superuser can still drop the append-only triggers.
- Login throttling is in-process memory only. No Dockerfiles for backend/frontend.
- An entry's date cannot be moved into another week (D-28); the weekly policy is checked only at
  submission.
- The repository is private on GitHub; commits use the account's noreply address.

## Not implemented (by scope)

Phase 7: administration (users, teams, manager assignment, projects, tasks, earning codes, policy
configuration with audit), reporting and hardening (security review, backup/restore guidance,
retention policy, deployment documentation).
