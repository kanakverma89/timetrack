# Testing strategy

| Layer | Tooling | Scope today |
| --- | --- | --- |
| Backend unit | pytest | week math (month/year/leap boundaries, all week-start days, business timezone), decimal summaries, config validation, password/token helpers, rate limiter |
| Backend API/integration | pytest + FastAPI `TestClient` against a real PostgreSQL | auth, CSRF/CORS, error envelope, health, reference data, week endpoint, data isolation, unauthenticated access |
| Database integrity | pytest | CHECK/FK/unique constraints enforced by PostgreSQL itself |
| Migrations | pytest + Alembic | apply from an empty DB, no drift vs models, downgrade to base and re-apply |
| Frontend unit/component | Vitest + Testing Library (`fetch` mocked at the network boundary) | date/hour utils, API client, dashboard components, full App flows (sign-in, navigation, loading/empty/error/retry, read-only, session expiry) |
| End-to-end | Playwright (Chromium, Firefox, WebKit) against the real API + disposable seeded DB | see below |
| Accessibility | `@axe-core/playwright` (WCAG 2.0/2.1/2.2 A+AA tags) + keyboard tests | login, dashboard in several states, mobile width |

## Isolation and determinism

- pytest recreates `timetrack_test` (derived from `DATABASE_URL`, or `TEST_DATABASE_URL`), migrates
  it with Alembic, and truncates all tables before each test. `assert_disposable` refuses any
  database name not ending in `_test`/`_e2e`.
- E2E recreates `timetrack_e2e` and seeds fixed-date weeks; specs navigate with `?week=` so they do
  not depend on today's date. No `waitForTimeout`; every wait is on a locator or URL.
- Credentials come from `SEED_PASSWORD` in the environment; no secrets are in source.

## Spec §12.3 first-milestone scenarios vs. current coverage

| # | Scenario | Status |
| --- | --- | --- |
| 1 | Sign in with test account | covered |
| 2 | Dashboard shows week and seven daily cards | covered |
| 3–11 | Add/edit/delete entry, validation, cancel warning, Week mode, batch atomicity | **not applicable yet** (Phases 3–4) |
| 12 | Weekly summary matches persisted API data | covered |
| 13–14 | Submit week; submitted entries read-only | submit **not implemented** (Phase 5); read-only *display* of a seeded submitted week is covered |
| 15 | Cannot access another employee's timesheet | partially: the API has no ID-addressable timesheet yet; isolation by authenticated identity is covered. ID tampering tests arrive with `/time-entries/{id}` |
| 16 | Failed request shows error and retry | covered (5xx, network failure, expired session) |
| 17 | Narrow viewport usable | covered at 375 px (Chromium/Firefox/WebKit engines resized; not real devices) |

## Known gaps

No performance measurement (spec §4.2), no screen-reader testing (axe finds only a subset of
issues), no CI run of the workflow, no concurrency tests (nothing mutates yet).
