# Security review (Phase 7)

Scope: the application in this repository as of Phase 7 (API, database, web container, build and CI).
Method: reading every route and service against the spec, writing the rules down as executable tests,
trying to break them (deliberate mutations: remove a guard, confirm a test fails), running dependency
audits, and exercising the production containers. This is an engineering review by the authors, **not an
independent penetration test**, and it has not been run against a real production deployment.

## Assets and trust boundaries

| Asset | Where | Who may touch it |
| --- | --- | --- |
| Hours and weekly decisions (the business record) | `time_entries`, `timesheet_weeks`, audit tables | the owner (draft weeks), the assigned manager or an admin (decisions) |
| Credentials | `users.password_hash` (Argon2id), `auth_sessions.token_digest` | nobody reads them; sessions are stored only as an HMAC digest |
| Personal data (names, emails, rejection reasons) | `users`, `approval_events.comment` | admins; managers see their own reports |
| Configuration (policy, catalogue, org structure) | `policy_settings`, projects, teams … | admins only, every change audited |

Boundaries: browser ↔ TLS terminator (yours) ↔ nginx ↔ API ↔ PostgreSQL. Only nginx faces the network.

## Authorization — enforced by a test, not a table in prose

`backend/app/tests/test_security_regression.py` holds a matrix of every route and the roles allowed to
call it. It fails if a route exists that is not listed (so a new endpoint cannot ship without someone
choosing its rule), if a listed route no longer exists, or if any of *anonymous / employee / manager /
admin* gets a different answer than the matrix says (63 tests). It also asserts:

- every state-changing route refuses a request **without** the `X-Requested-With: timetrack` header and
  one carrying a **foreign `Origin`**, and lets a correct request through to authentication;
- a signed-out visitor gets the identical `401` for real and invented ids (no enumeration);
- production mode: docs and the OpenAPI document are 404, the cookie is `Secure; HttpOnly; SameSite=Lax`,
  HSTS is sent; development mode keeps docs working;
- hardening headers on every response (including 404s and errors); CORS never reflects an arbitrary
  origin or `*`; error bodies contain no stack trace, SQL, driver name or file path.

Object-level rules (an employee sees only their own weeks; a manager reviews only assigned reports and
never themself; team membership grants nothing) are in `test_api_approvals.py` and
`test_review_policy.py`, with a parity test tying the SQL scope to the pure policy function.

Mutation evidence: removing the manager/admin guard on the reports router made the matrix fail for the
employee on `/reports/hours`; exempting one path from the CSRF check failed four tests.

## Findings and dispositions

| # | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| S-1 | Two administrators demoting/deactivating each other concurrently could both pass the "another admin remains" check and leave nobody in charge | High | **Fixed**: all active admin rows are locked (`FOR UPDATE`) before the check; a two-thread test reproduces the race |
| S-2 | The append-only admin audit trail stored emails and old/new display names (user changes) and member emails (team membership changes), which anonymisation could not remove from a table that cannot be edited | Medium | **Fixed**: audit rows hold ids only and record *that* a name changed, not its value; the audit view resolves *current* names, so an anonymised person reads "Former employee". The team-membership case was found while building the audit screen, after the first fix. Rows written by an earlier development build may still hold emails; no production data existed |
| S-3 | `FailureLimiter` (login throttle) grew without bound under a flood of distinct keys (memory exhaustion by an unauthenticated caller) | Medium | **Fixed**: key count capped; expired keys are evicted first, then the oldest. Residual risk: under a deliberate flood an attacker can evict *other* people's counters and so reset their throttle (accepted, below) |
| S-4 | A user with a temporary password could otherwise use the whole API before changing it | Medium | **Fixed**: every route except `me`, `change-password` and `logout` answers 403 until the password is changed (tested for all three roles on every route in the matrix other than the public and exempt ones; widening the exemption list by one path made it fail) |
| S-5 | Changing the password with a wrong *current* password returning 401 would look like an expired session and sign the user out | Low | **Fixed**: it is a 422 field error; other sessions are revoked on success |
| S-6 | CSV export of free text allows spreadsheet formula injection (`=cmd|…`) | Medium | **Fixed**: cells starting with `= + - @ TAB CR` are prefixed with a quote; the export contains no descriptions in any case |
| S-7 | No `Content-Security-Policy` / `Permissions-Policy` / HSTS | Low | **Fixed**: API sends `default-src 'none'`; nginx sends a same-origin CSP for the app; HSTS when cookies are `Secure`. Verified on the running containers: one CSP header, no duplicates, and the real app loaded through nginx in Chromium, Firefox and WebKit — sign-in, forced password change and 14 screens/dialogs (timesheet, entry panel, every admin page, user/team dialogs, delete confirmation, reports, approvals) — with **zero CSP violations in Chromium and Firefox**. WebKit reports `style-src-attr` for native `<select>` elements, see R-9 |
| S-8 | Password rules: names/emails could be smuggled in with punctuation (`ma.ria`) | Low | **Fixed**: comparison ignores punctuation and case |
| S-9 | Dependencies | — | `pip-audit` and `npm audit`: **no known vulnerabilities** on 2026-10-24 (including dev dependencies). A scheduled workflow repeats this weekly |

No finding allowed reading or changing another person's data; S-1 and S-2 were found by reasoning and
review, not by an exploit in a deployed system.

## Threats considered (STRIDE, abbreviated)

| Threat | Mitigation | Residual |
| --- | --- | --- |
| **Spoofing** — password guessing, stolen session | Argon2id; throttle per address+email; sessions are 256-bit random, stored as HMAC digests, `HttpOnly`, `Secure`, `SameSite=Lax`, expire, revoked on password change/deactivation | Throttle is in-process and evictable (R-1). No MFA / SSO (spec's OIDC path is not built) |
| **Tampering** — editing someone else's data, rewriting history | Authorization matrix; row locks and optimistic versions; DB triggers make the three audit tables append-only | A database superuser can drop the triggers (R-3) |
| **Repudiation** | Every decision and every configuration change records actor and time, in the same transaction as the change | Rejection reason text is free-form |
| **Information disclosure** | 404 vs 403 policy, no stack traces, no secrets in logs or audit details, no descriptions in exports/audit | Names appear in reports to managers by design. Backups contain everything |
| **Denial of service** | Pagination caps, 366-day report limit, 100 000-row export cap, request body cap in nginx, bounded limiter | No rate limiting beyond login; no WAF; single API process (R-2) |
| **Elevation of privilege** | Role guard on whole routers; self-role-change and last-admin protections; temporary-password lockdown | — |
| **CSRF / XSS / clickjacking** | Custom-header + Origin check; React escaping, no `dangerouslySetInnerHTML`; CSP `script-src 'self'`; `frame-ancestors 'none'` | The CSRF defence relies on browsers enforcing CORS for custom headers |

## Accepted risks and open items

- **R-1 In-process login throttle.** Resets on restart, multiplies with replicas, can be evicted by a
  flood of distinct keys. Acceptable for a single-instance deployment; use the database or a cache
  before scaling out.
- **R-2 Single API process** and no general rate limiting.
- **R-3 Privileged database access** can disable the audit triggers or edit rows. Restrict who holds
  the database credentials; consider a separate migration role for DDL.
- **R-4 Backups hold everything**, including identities removed from the live database. Encrypt them,
  limit access, and apply your own retention.
- **R-5 No MFA / SSO.** Local accounts only.
- **R-6 `--forwarded-allow-ips '*'`** in the API image is safe only while the API port is unpublished
  (see `docs/operations.md`).
- **R-7 Not assessed:** the TLS terminator and host/OS, container base-image vulnerabilities, secrets
  management, network policy, and anything in a real deployment that differs from `compose.prod.yaml`.
- **R-8 Screen-reader and assistive-technology behaviour** is not a security matter but remains
  unverified by a person using real assistive technology.
- **R-9 WebKit CSP reports for native `<select>`.** Under the production CSP (`style-src 'self'`), WebKit logs
  `style-src-attr` violations for form controls with no author styles at all (reproduced on a bare page with
  a static `<select>`; Chromium and Firefox are silent). In the real app the select rendered pixel-identically
  with and without the CSP and selecting a value worked, so this is console noise, not a defect, and
  loosening `style-src-attr` did not silence it. No `report-uri` is configured, so nothing is collected. The
  modal scroll lock was changed from `body.style.overflow` to a CSS class (`modal-open`) while investigating;
  that was *not* the cause but is kept as the stricter-CSP-friendly form.
- **R-10 The CSP was exercised against the real nginx container only with the API in test mode** (a
  production-mode API refuses plain-HTTP sign-in from a browser: `Secure` cookie, `https://` origins only), so
  authenticated screens were checked with the same web image and nginx configuration but not the production
  API settings.
