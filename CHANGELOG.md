# Changelog

All notable changes to TimeTrack. The project has no version tags yet, so entries are grouped by milestone and
dated; each corresponds to merged work in the git history. Phases 0–7 follow [`spec.md`](spec.md); what was
verified for each is recorded in [`docs/implementation-report.md`](docs/implementation-report.md).

## 2026-10-26

### Documentation
- Product-oriented README with architecture, lifecycle and schema diagrams, a security summary and a quality
  overview; developer setup moved to [`docs/development.md`](docs/development.md).
- E2E test-case workbook ([`docs/e2e-test-cases.xlsx`](docs/e2e-test-cases.xlsx)) and a Playwright study guide.
- Interactive system views (architecture, sequence, data flow, lifecycle, schema, workflow) in `docs/system-views/`.

## 2026-10-25 — Live demo, withdraw, redesign

### Added
- **Withdraw a submission:** an employee can take a submitted week back to draft while no manager has decided.
- **Live demo** on a free tier (Vercel frontend, Render API, Neon PostgreSQL), with a manual `deploy-verify`
  workflow that runs the smoke tests against it.
- User guide and a complete guide (HTML source and a 33-page PDF).

### Changed
- **Enterprise look:** Inter font, dark header, refined cards and tables, redesigned sign-in page.
- Render now runs migrations and the server from a start script; the API is pinned to the Ohio region, next to
  the database.

### Fixed
- The next person to sign in was sent to the page the previous person signed out from.
- The Withdraw button briefly faded from the Submit button's colour.

## 2026-10-24 — Phase 7: administration, reporting and hardening

### Added
- **Administration:** users, teams, projects and tasks, earning codes, the hour policy, and an audit log that
  holds no personal data. Password change, with a temporary-password lockdown covered across the whole route matrix.
- **Reports** page with CSV export.
- Maintenance CLI (`purge`, `anonymise-user`, `create-admin`), production packaging (`compose.prod.yaml`) and a
  backup and restore drill.
- Operations guide, security review (STRIDE, accepted risks) and a recorded performance check.
- Dependency audit workflow.

### Security
- Hardened response headers and the login rate limiter; added a security regression suite.

## 2026-10-24 — Phase 6: manager approvals

### Added
- Approvals queue: a manager reviews the weeks of the people they manage and approves, or rejects with a reason.
- Backend, UI and E2E coverage.

## 2026-10-24 — Phase 5: weekly submission

### Added
- Submit a week once entries pass the configured limits; a rejected week becomes editable and can be resubmitted.

## 2026-10-24 — Continuous integration

### Changed
- CI actions updated to Node 24 releases on a pinned runner, with Python and Node version matrices.
- The real Node minimum (22.22) is declared and enforced; CI tests Node 22, 24 and 26.

### Added
- Repeatable performance check, with results recorded against the spec targets.

## 2026-10-24 — Phase 4: Week-mode time entry

### Added
- Enter a whole week in one grid and save it as a batch.

## 2026-10-23 → 2026-10-24 — Phase 3: Day-mode time entry

### Added
- Create, edit and delete a time entry for a single day.

## 2026-10-23 — Phases 0–2: foundation and Employee Dashboard

### Added
- Project foundation: React and TypeScript frontend, FastAPI backend, PostgreSQL with Alembic migrations, Docker
  Compose for local development, and CI.
- Session-based authentication (Argon2id, HttpOnly cookie, CSRF guard).
- Read-only Employee Dashboard showing the week, its entries and summaries.
