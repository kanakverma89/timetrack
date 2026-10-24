# Implementation report — Phases 0–7

Date: 2026-10-24. Local environment: macOS (Apple silicon, 8 CPUs), Python 3.14.7, Node 26.7.0, Docker
29.7.2 with `postgres:16`. CI: GitHub Actions on `ubuntu-24.04` (Python 3.12/3.14, Node 22/24/26).
Everything marked "ran" was executed; anything not listed was not run.

## Completed

- **Phases 0–5** — foundation, Employee Dashboard, Day- and Week-mode time entry, weekly submission
  (see `docs/decisions.md` D-1 to D-50 for every design choice).
- **Phase 6** — manager approvals: assigned manager or administrator only, never your own week,
  required rejection reason, append-only audit, employee notification through the outbox, an Approvals
  list and review page (D-51 to D-58).
- **Phase 7 (administration, reporting and hardening)** — D-59 to D-72:
  - **People:** create (a generated temporary password is shown **once**, never stored or logged), edit,
    assign a manager, deactivate/reactivate, reset a password. A temporary password locks every API route
    except *change password* until it is replaced; the app redirects there. Password policy (12–128
    characters, common passwords, name/email) and a voluntary *Change password* page. Rails: you cannot
    change your own role, deactivate or reset yourself; the last active administrator cannot be removed
    (race-safe); a manager with active reports cannot be deactivated until they are reassigned.
  - **Structure and catalogue:** teams (organisational only — approval rights still come solely from the
    assigned manager), projects, tasks, earning codes. Codes are immutable; things are deactivated, not
    deleted; a project with an active task requires one on new entries; an earning code's classification
    is locked once entries use it.
  - **Hour policy:** per-entry, daily and weekly limits and description length, stored in the database
    over the environment defaults, validated against each other, applied at once, *restore defaults*.
  - **Audit:** every change is recorded in the same transaction, append-only (database trigger), with **no
    personal data** — ids only; names are resolved when the audit screen reads, so an anonymised person
    reads "Former employee".
  - **Reports:** hours by person, project, earning code or week; scope identical to approvals; drafts never
    included; CSV export of the same query with spreadsheet-formula neutralisation and an export log.
  - **Hardening and operations:** an enforced route × role access matrix, security headers and CSP,
    bounded login limiter, weekly dependency audit; `maintain.py` (`purge`, `anonymise-user`,
    `create-admin`); production Dockerfiles, nginx and `compose.prod.yaml`; `docs/operations.md`
    (deployment, configuration, backup and restore, retention); `docs/security-review.md`; a backup/restore
    drill script.

## Verification (commands actually run, final state)

| Check | Result |
| --- | --- |
| `ruff check` / `ruff format --check` (backend) | pass / pass (105 files) |
| `mypy app scripts` (strict) | no issues in 104 files |
| `pytest` (backend, real PostgreSQL) | **540 passed**, 1 warning (Starlette deprecation notice about `httpx` in its test client) |
| `alembic upgrade head`, `alembic check` | applied; "No new upgrade operations detected" (down/up round trip covered by pytest) |
| `npm run lint`, `format:check`, `typecheck` | pass / pass / pass |
| `npm test` (Vitest) | **254 passed** in 18 files |
| `npm run build` | succeeds |
| `npx playwright test` — Chromium, Firefox, WebKit, local | **362 passed, 7 skipped** (369 tests), three complete runs with identical results (8.0, 7.8 and 7.4 minutes; the third on the final code). Includes 93 admin tests (31 × 3 browsers) that run last, one browser after another. Skips: 3 optional screenshot captures, 4 WebKit keyboard-Tab tests |
| `scripts/perf_check.py` (two runs) | every p95 far under 500 ms: dashboard 6.1 ms, save 10.8 ms, admin lists 4–8 ms, create user 64 ms (includes Argon2id), reports 42–65 ms over a year of 15,451 entries; see `docs/performance.md` |
| `pip-audit`, `npm audit` | no known vulnerabilities (Python dependencies; all npm dependencies including development ones) |
| `scripts/backup-restore-drill.sh` | passed against the development database: 16 tables with identical row counts, same schema version, 3 triggers present, `UPDATE` refused on both non-empty audit tables, throwaway database dropped |
| `docker compose -f compose.prod.yaml up --build --wait` | all four services built and healthy; API runs as UID 10001 on a read-only filesystem; first administrator created with the CLI; sign-in through nginx; HSTS, one CSP, `Secure` cookie, docs 404, forced password change enforced; real client address visible to the API behind nginx |
| CSP walk-through of the nginx-served app (Chromium, Firefox, WebKit) | sign-in, forced change and 14 screens/dialogs completed in each; **no CSP violations in Chromium or Firefox**; WebKit logs `style-src-attr` reports for native selects (engine quirk, no visible or functional effect found; `security-review.md` R-9). Run with the API in test mode, see R-10 |
| GitHub Actions on the Phase 7 branch | see the end of this document |

### Mutation checks for Phase 7 (change the code, confirm a test fails)

Backend: dropping the manager/admin guard on the reports router (matrix test fails for the employee);
exempting one path from the CSRF check (four tests fail); widening the temporary-password exemption list by
one path (lockdown test fails); letting `purge` delete FAILED/PROCESSING outbox rows (test fails); storing
display names in the audit (two tests fail). Frontend: removing the forced-change redirect (3 tests), sending
every field instead of the changed ones (2), letting Escape dismiss the temporary-password dialog (1),
un-locking the classification control (1), removing the range check on reports (1), showing the Admin link
to non-admins (2), reverting the modal lock to an inline style (2). Two mutations were **not** caught at
first: dropping the "refocus the error after every attempt" counter (a test was added, now caught), and
removing the in-flight `useRef` guard in the user dialog — the dialog's shared `pending` guard already
prevents a double submit, in unit and real-browser tests alike, so that extra ref is defence in depth that
no test can tell apart from it.

## Defects found by this work (and fixed)

Application and design:

- **Personal data in an append-only table.** Admin audit rows held emails and old/new names, and team
  membership changes held member emails; anonymisation could not have removed them. Found in review, then
  the team case again while building the audit screen. Audit rows now hold ids only (D-67).
- **Last-administrator race:** two administrators removing each other at once could both pass the "someone
  else remains" check. Fixed with a row lock; reproduced by a two-thread test.
- **Silent form error:** the server's "reassign their reports first" error belonged to the *Active*
  checkbox, which had nowhere to show it, so people would have seen "fix the highlighted fields" with
  nothing highlighted. Found by an E2E test; checkboxes now show errors.
- **A UI hint that contradicted the server:** the earning-code form said changing the classification
  "affects existing entries" while the server forbids it once entries exist. The control is now disabled with
  the real reason.
- **Inconsistent numbers:** the environment's policy defaults read `24` while saved values read `24.00`,
  which also produced a phantom "60.00 → 60" in the audit. Defaults are now quantised alike.
- **Focus after a repeated failure:** when a second attempt failed with the same message, focus stayed on a
  disabled button. Focus now returns to the error after every failed attempt (D-71).
- **375 px overflow:** four navigation links for administrators scrolled the page sideways; they now wrap.
- **CSV formula injection, unbounded login-limiter memory, missing CSP/Permissions-Policy/HSTS, wrong-
  current-password returning 401 (which looks like an expired session):** see `security-review.md`.

Test-side mistakes, recorded because they cost time and could have hidden real problems: a helper that
dropped a `role: undefined` field, two tests sharing one week key, assertions that assumed names were unique
across browsers sharing a database, a checkbox `check()` that expected an instant flip from a URL-driven
control, `--repeat-each` on tests that approve un-resettable weeks, an unscoped label that also matched a
navigation link, and three Firefox 30-second timeouts under full parallel load (multi-context and axe-heavy
tests are now marked `test.slow()`; they take 11–13 s alone).

## Not verified / known limitations

- **Production deployment.** The images were built and smoke-tested locally; nothing was deployed.
  There is **no TLS** in the repository (terminate it in front of nginx), no container-image scanning, no
  secrets manager, no monitoring or alerting, no real notification provider (the outbox feeds a logging
  adapter), and the CSP was exercised against a test-mode API (R-10).
- **Backups:** the drill ran on a small development database against the same Postgres major version. It
  does not test a corrupt or truncated dump, a different PostgreSQL version, or off-host storage.
- **Security:** an engineering review by the authors, not an independent penetration test (see
  `security-review.md`). No MFA/SSO. The login limiter is in-process and evictable under a flood. The API
  image trusts forwarded headers because its port is unpublished.
- **Accessibility:** automated axe checks and keyboard tests only; **no screen reader and no real mobile
  device**. WebKit Tab order is not asserted.
- **Performance:** one machine, one worker, one year of 50 people; larger organisations, longer report
  ranges and a networked database are untested. The retention purge and anonymisation were tested for
  correctness, not speed on large tables.
- **Retention:** thirty-day windows are a default, not a legal recommendation. Anonymisation does not reach
  backups, logs or free-text rejection reasons.
- **Anonymisation and old data:** audit rows written by an earlier development build of this phase may still
  contain emails (no production data existed).
- Authorization is by direct assignment only: no delegation, no multi-level approval. An entry's date cannot
  be moved into another week (D-28). Outbox rows left in `PROCESSING` by a crash are not recovered.
- The repository is private on GitHub; commits use the account's noreply address.

## Not implemented (by scope)

SSO/MFA, TLS termination, email/chat delivery of notifications, delegation and multi-level approval,
scheduled reports, an in-app notification inbox, container image scanning.
