# Testing strategy

| Layer | Tooling | Scope today |
| --- | --- | --- |
| Backend unit | pytest | week math (month/year/leap boundaries, all week-start days, business timezone), decimal summaries, config validation, password/token helpers, rate limiter |
| Backend API/integration | pytest + FastAPI `TestClient` against a real PostgreSQL | auth, CSRF/CORS, error envelope, health, reference data, week endpoint, data isolation, unauthenticated access; **entry create/update/delete**: validation matrix, task rules, ownership (404), locked weeks (409), optimistic concurrency, audit events, and real concurrent requests (parallel first writes → one week; parallel same-version updates → one winner); **batch**: all-or-nothing (invalid item → nothing persisted incl. no week row), forced mid-transaction failure rolls back, same-week/duplicate-date/size rules, per-item error addressing, concurrent batches; **submission**: lifecycle (DRAFT/REJECTED ok, SUBMITTED/APPROVED 409), validation and policy, audit + outbox written together, rollback when a late step fails, idempotent retries, true concurrent submits (one transition), delivery success/failure/retry/parking, no free text in logs or payloads; **approvals**: exhaustive policy truth table, SQL-scope/policy parity, 403/404 policy (no probing), pagination and filters, approve/reject effects (status, reviewer, event, outbox without the reason), reason validation, full reject→fix→resubmit→approve cycle, self-review, racing reviewers (one wins), rollback on failure, idempotent retries, database-level append-only audit; **administration**: user lifecycle (temporary password once, forced change, session revocation, last-administrator race with real threads, self-lockout, manager rules), password policy, catalogue and policy validation, team membership, audit rows without personal data, reports (scope, statuses, totals, CSV formula injection, export logging), retention purge/anonymise/create-admin; **security regression**: the route × role matrix for every route, CSRF/Origin on every state-changing route, temporary-password lockdown on every route, production-mode headers/docs/cookies, CORS, error-body leakage |
| Database integrity | pytest | CHECK/FK/unique constraints enforced by PostgreSQL itself |
| Migrations | pytest + Alembic | apply from an empty DB, no drift vs models, downgrade to base and re-apply |
| Frontend unit/component | Vitest + Testing Library (`fetch` mocked at the network boundary) | date/hour utils, API client, dashboard components, full App flows (sign-in, navigation, loading/empty/error/retry, read-only, session expiry); entry validation, project combobox, and the add/edit/delete/discard flows against a stateful fake API (focus, double-submit, stale task, 422/409 handling); **Week mode**: exact live total, which days are sent, server errors mapped back to the right day, mode switching keeps data; **submission dialog**: exact request (body + idempotency header), one key per action, error mapping to entries/days, focus on error, instant double-click sends one request; **approvals UI**: role guard and nav badge, list filters/paging/empty/error states, review page, approve/reject dialogs (reason required, key stability, conflict handling), employee-side decision banners; **administration UI**: forced password change (redirect, local checks, server errors, one request on a double click), navigation by role, users (list/filters, one-time password dialog that cannot be dismissed by accident, edit sends only changed fields, field errors beside the right control, self-protection), teams (members dialog keeps choices across searches), projects/tasks, earning codes (classification lock), policy (validation, null = no limit, restore), audit wording, reports (URL ↔ request, range checks, CSV link), modal page lock |
| End-to-end | Playwright (Chromium, Firefox, WebKit) against the real API + disposable seeded DB | see below |
| Accessibility | `@axe-core/playwright` (WCAG 2.0/2.1/2.2 A+AA tags) + keyboard tests | login, dashboard in several states, approvals, every admin page and dialog (including with errors showing), reports, change-password, mobile width |
| Security / operations | `pip-audit`, `npm audit` (weekly workflow), `scripts/backup-restore-drill.sh`, a manual smoke test of `compose.prod.yaml`, a CSP walk-through of the nginx-served app in three browsers | see `docs/security-review.md`, `docs/operations.md` |

## Helper for states without an API yet

`backend/scripts/e2e_state.py` sets a week to REJECTED/APPROVED in the disposable E2E database so
tests can cover those states before manager decisions exist (Phase 6). It refuses any database name
not ending `_test`/`_e2e`.

## Isolation and determinism

- pytest recreates `timetrack_test` (derived from `DATABASE_URL`, or `TEST_DATABASE_URL`), migrates
  it with Alembic, and truncates all tables before each test. `assert_disposable` refuses any
  database name not ending in `_test`/`_e2e`.
- E2E recreates `timetrack_e2e` and seeds fixed-date weeks; specs navigate with `?week=` so they do
  not depend on today's date. No `waitForTimeout`; every wait is on a locator or URL.
- Tests that write data each own one far-future week derived from a registered key and the browser
  project (`weekFor` in `tests/e2e/fixtures.ts`), and empty it first, so parallel tests and
  retries never share data. Seeded weeks are never mutated.
- Credentials come from `SEED_PASSWORD` in the environment; no secrets are in source.

## Spec §12.3 first-milestone scenarios vs. current coverage

| # | Scenario | Status |
| --- | --- | --- |
| 1 | Sign in with test account | covered |
| 2 | Dashboard shows week and seven daily cards | covered |
| 3 | Open Add Time Entry in Day mode | covered |
| 4 | Required-field validation shown | covered (client and server) |
| 5 | Select a project, then a valid task | covered |
| 6 | Save entry; appears in list and daily total | covered, incl. persistence across reload and in the API |
| 7 | Edit a draft entry; totals update | covered |
| 8 | Cancel an edited form; warned before discarding | covered |
| 9 | Delete a draft entry after confirmation | covered |
| 10 | Multi-day entry in Week mode, calculated total | covered (live total; persisted as separate dated records; reload) |
| 11 | Invalid batch rejected without partial saving | covered via a request corrupted in flight (UI shows the failing day, DB has no entries and no week row) plus direct API tests |
| 12 | Weekly summary matches persisted API data | covered, including after mutations and for 0.10 + 0.20 |
| 13 | Submit a valid week | covered (confirmation, Submitted status, persisted, survives reload); also policy errors, resubmission of a rejected week, empty week, duplicates/idempotency |
| 14 | Submitted entries read-only | covered for a week submitted through the UI and for seeded weeks (no controls; every write returns 409) |
| 15 | Cannot access/modify another employee's data | covered for entries by id (404 for patch/delete/unknown); there is no ID-addressable timesheet endpoint yet |
| 16 | Failed request shows error and retry | covered (5xx, network failure, expired session) |
| 17 | Narrow viewport usable | covered at 375 px for the dashboard, the entry panel and the Week grid |

## Admin specs and shared state

Specs named `admin-*.spec.ts` change configuration shared by every user (policy, catalogue, people). They
run in dedicated Playwright projects (`admin-chromium` → `admin-firefox` → `admin-webkit`), one after the
other and only after the main projects have finished, so a test that depends on a limit never sees it
change. Inside them everything is created with unique emails, codes and names, and the policy specs run
serially (they share one setting). Because the three browsers share one database in a full run, assertions
must not depend on a name or an email being unique across browsers (two such mistakes were found and fixed).

## Known gaps

No screen-reader testing (axe finds only a subset of issues). WebKit Tab-order assertions are skipped
(four tests) and three optional screenshot captures are skipped. The production container was smoke-tested
by hand and its CSP walked through with a script, but there is no automated test of the production images.
Performance was measured on one machine only. CI (GitHub Actions, Ubuntu, Python 3.12/3.14, Node 22/24/26)
runs the backend and frontend suites and the full Playwright suite on three browsers.

## Phase 6 acceptance criteria ↔ evidence

| Criterion (spec §13, Phase 6) | Where it is tested |
| --- | --- |
| Only authorized managers can access assigned submissions | `test_review_policy.py`, `test_api_approvals.py` (scope, parity, 404/403), E2E "a manager only ever sees their own reports", "an employee has no approvals page…", "nobody can review their own week" |
| Approved/rejected status persists | backend decision tests; E2E workflow (employee reloads and sees it) |
| Rejection reason visible to the employee | backend `review_comment` / `reviewed_by_name`; E2E cycle test (employee sees reason, reviewer, time) |
| All decisions auditable | backend history/event tests; DB append-only tests; E2E history of four steps in order |
| Manager and employee workflow E2E | `approvals.spec.ts` (submit→review→approve; reject→fix→resubmit→approve; two reviewers racing) |

## Phase 7 acceptance criteria ↔ evidence

| Criterion (spec §13, Phase 7) | Where it is tested / shown |
| --- | --- |
| Configuration changes are validated | backend: `test_admin_users.py`, `test_admin_config.py` (every field, duplicates, ranges, cross-field policy rules); UI: unit and E2E tests show each server message beside its field |
| …and auditable | backend: an audit row in the same transaction for every change, rolled back together, append-only trigger, **no personal data** (`test_maintenance.py`, `test_admin_config.py`); E2E `admin-teams-audit.spec.ts` (what/who/before-after, names resolved at read time, no emails or passwords on screen) |
| Security regression suite passes | `test_security_regression.py` (63 tests): every route classified and checked for four roles; CSRF/Origin; temporary-password lockdown; production mode; headers; CORS; leakage. Mutation checks recorded in the implementation report |
| Operational and deployment instructions | `docs/operations.md`, `compose.prod.yaml`, Dockerfiles, `scripts/backup-restore-drill.sh` (run and passed), `scripts/maintain.py` (tested), production stack built and smoke-tested. **Not** run in a real environment |
| Performance measured and documented | `scripts/perf_check.py` (two runs), `docs/performance.md` |
| User/team, project/task/earning-code management; hour policy | E2E `admin-users`, `admin-catalog`, `admin-policy`, `admin-teams-audit` on three browsers (each effect is checked from the employee's side too: a new project is offered, a saved limit is enforced, a deactivated person is signed out) |
| Reporting and pagination | backend `test_reports.py`; unit `Reports.test.tsx`; E2E `reports.spec.ts` (numbers reconcile across groupings, CSV equals the report, scope by manager, drafts excluded) |
| Security review, backup/restore guidance, retention policy | `docs/security-review.md`, `docs/operations.md` (backup, restore, drill, retention table, CLI) |
