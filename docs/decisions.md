# Decisions

Conservative defaults chosen where `spec.md` leaves room. Each is revisitable.

| ID | Decision | Rationale |
| --- | --- | --- |
| D-1 | **Project root is the current directory**, not a nested `timesheet-app/`. | Directory is already the project; avoids a redundant level. |
| D-2 | **Auth = local email/password**, Argon2id, server-side sessions in an HttpOnly cookie. OIDC is the production-preferred path and can replace `security/sessions.py` later. | Self-contained prototype per spec §11.1; no employer IdP coupling. `.env.example` uses `SESSION_TTL_HOURS` instead of access/refresh token settings because there are no bearer tokens. |
| D-3 | Session token digest is stored with HMAC-SHA256 keyed by `SESSION_SECRET`. | A DB leak alone does not yield usable session tokens. |
| D-4 | CSRF guard = required `X-Requested-With: timetrack` header + `Origin` allow-list check on unsafe methods. | Simple, stateless, works with SameSite=Lax; no token round-trip. |
| D-5 | **Login throttling is in-memory** (5 failures / 15 min per address+email). | Adequate for one process. Documented limitation; use Redis or a DB table before scaling out. |
| D-6 | **`GET /timesheets/weeks/{date}` is read-only.** If no week row exists it returns an empty `DRAFT` representation with `id: null`. The row is created on the first write (Phase 3). | Repeated GETs can never create duplicates and GET stays side-effect free (spec §8.4 allows either). |
| D-7 | The week endpoint **normalises any date** to its week start and returns the normalised dates. Years outside 1970–2100 are rejected with 422. | Robust navigation and deep links; avoids date overflow. |
| D-8 | `GET /meta` returns business timezone, week start day, server "today", current week start and entry limits. | Business dates come from the server, not the browser clock. |
| D-9 | **No UI component library**; small accessible custom components with CSS tokens. | Few components in this milestone; native elements give accessibility for free; avoids a heavy dependency. Revisit for the combobox in Phase 3. |
| D-10 | **TanStack Query** for server state, no global store. | Retry, caching and de-duplication are needed; shared client state is not. |
| D-11 | Entry "status" equals the parent week's status; `draft_count` = number of entries while the week is `DRAFT` or `REJECTED` (editable), else 0. | Entries have no status column in spec §7.8. |
| D-12 | Capped/non-capped comes only from `earning_codes.classification`. Seed meaning of "capped" is illustrative and policy-neutral. | Spec §3.4, §7.6. |
| D-13 | Hours are `NUMERIC(5,2)` in the DB, `Decimal` in Python, **strings** in JSON, and never floats. DB check: `0 < hours <= 24`; app-level per-entry maximum is `MAX_HOURS_PER_ENTRY` (default 24). | Spec §3.4, §8.1. |
| D-14 | Reference-data routes call repositories directly (no pass-through service). | Avoids empty abstraction; add a service when rules appear. |
| D-15 | Sync SQLAlchemy 2.x with `psycopg` 3; FastAPI sync path operations run in the thread pool. | Simpler transactions/locking (`SELECT … FOR UPDATE` in Phase 5); load is modest. |
| D-16 | Seeded users share one password supplied via `SEED_PASSWORD`; the seed script refuses to run without it (min 12 chars) and in `production`. | No credentials in source. |
| D-17 | Cross-table "work_date inside the week" is enforced in the service layer (Phase 3), not by a DB trigger. Other integrity rules (owner match, task⇄project) use composite FKs. | Triggers add operational surface; revisit during hardening. |
| D-18 | English (`en-US`) formatting and Monday-first display only. | i18n is out of scope. |
| D-19 | Light theme only (WCAG-oriented contrast, visible focus). | Dark mode is not required for the milestone. |
| D-20 | Phase 2 has no "Add entry" button and no row actions. | Controls that do nothing would be placeholders; they arrive with Phase 3. |
| D-21 | A `403`/`404` policy: unknown or foreign resources return `404 NOT_FOUND`; missing role returns `403 FORBIDDEN`. | Avoids resource enumeration (spec §11.2). Applies from Phase 3. |
| D-22 | **ESLint is pinned to v9** (`eslint`, `@eslint/js`). | `eslint-plugin-jsx-a11y@6` declares peer support only up to ESLint 9; v10 would need `--legacy-peer-deps`. Revisit when the plugin supports v10. |
| D-23 | The query client retries transient failures (network, 5xx) twice and never retries 4xx. A 401 on any data request clears the cached session and returns the user to sign-in with a notice. | Spec §10.1 (error + retry, expired session). |
| D-24 | E2E runs against a disposable `timetrack_e2e` database recreated and seeded on every run by `backend/scripts/prepare_db.py`; the login throttle is raised for that run only. Phase 2 specs are read-only so they can run in parallel across browsers; mutating specs (Phase 3+) must create their own data or run serially. | Deterministic data, no cleanup logic. |
| D-25 | Tab-order assertions are skipped on WebKit/macOS (Safari-family engines do not Tab onto buttons by default); keyboard activation is still tested on all engines. | Engine behaviour, not an app defect (native `<button>`s are used). |
| D-26 | Only Python 3.14 and Node 26 were available to develop on; `requires-python >=3.12` and Node ≥ 20 are declared but unverified. | See implementation report. |

## Open questions (no answer needed to proceed)

- What does "capped" mean for the business (e.g. a weekly cap on a class of hours)? Currently only
  a classification; no cap is enforced.
- Should past/future weeks be restricted? Not restricted; no policy was given.
- Is withdrawal of a submitted week wanted? Not designed; `WITHDRAWN` exists in the audit enum only
  as an option.
