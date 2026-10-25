# TimeTrack user guide

A hands-on guide: how to run the app, what each kind of user can do, how to create users, end-to-end
scenarios to try, and what you can test (UI, API, database, performance, security).

Everything here describes the app as built. Where a step says "expect", that is what the code is designed
to do and what the automated tests check; if you see something different, that is worth investigating.

---

## 1. What TimeTrack is

A weekly timesheet app. **Employees** log hours against projects (and tasks) with an earning code, then
**submit** the week. A **manager** reviews and **approves or rejects** it. An **administrator** manages
people, projects, codes and hour limits, and can read an audit log. Managers and administrators can run
**reports**.

A week's life: `DRAFT → SUBMITTED → APPROVED` (final) or `→ REJECTED` (the employee fixes it and resubmits).
While a week is `SUBMITTED` and no manager has decided, the employee can **withdraw** it back to `DRAFT`.

## 2. Start it

```bash
cd /Users/kanakverma/repos/timetrack
scripts/dev-up.sh          # database + API (port 8000) + web (port 5173)
scripts/dev-down.sh        # stop everything (database data is kept)
```

Open **http://localhost:5173**. The API's interactive docs are at **http://localhost:8000/api/v1/docs**
(development only).

### Demo accounts (synthetic data)

All six share one password: the `SEED_PASSWORD` value in your `.env` file.

| Email | Name | Role | Reports to |
| --- | --- | --- | --- |
| `employee@example.test` | Alex Employee | Employee | Morgan |
| `employee2@example.test` | Sam Employee | Employee | Morgan |
| `employee3@example.test` | Taylor Employee | Employee | Riley |
| `manager@example.test` | Morgan Manager | Manager | — |
| `manager2@example.test` | Riley Manager | Manager | — |
| `admin@example.test` | Jordan Admin | Administrator | — |

To (re)load the demo data: `cd backend && set -a && . ../.env && set +a && .venv/bin/python scripts/seed.py --sample-entries`.
Alex's sample weeks (Monday-first) are `2026-10-19` and `2026-10-12` (drafts), `2026-10-05` (submitted) and
`2026-09-28` (rejected), e.g. `http://localhost:5173/?week=2026-10-05`.

**Tip:** use two browser profiles, or one normal and one private window, to be signed in as two people at
once (an employee and their manager).

## 3. Who can do what

| | Employee | Manager | Administrator |
| --- | --- | --- | --- |
| Log, edit, delete own hours; submit own weeks | ✅ | ✅ | ✅ |
| Change own password | ✅ | ✅ | ✅ |
| See **Approvals**; approve/reject | ❌ | ✅ for people who **report to them** | ✅ for everyone |
| Review **their own** week | — | ❌ never | ❌ never |
| **Reports** and CSV export | ❌ | ✅ their reports only | ✅ everyone |
| **Admin** area (users, teams, projects, codes, policy, audit) | ❌ | ❌ | ✅ |

Two rules that surprise people:

- **Team membership gives no authority.** Only a person's assigned **manager** (set on the user) can approve
  their weeks. Teams are just groupings.
- Nobody can approve their **own** week, not even an administrator.

---

## 4. Employee guide

Sign in as `employee@example.test`. You land on **Timesheet**, showing the current week.

### The screen
- **Week navigator**: Previous week / Next week / Current week. The address (`?week=YYYY-MM-DD`) can be
  bookmarked.
- **Day cards** with each day's hours, **Weekly summary** (total, capped, non-capped, draft entries) and the
  list of entries.
- **Add entry** (top right) and **Submit week**.

### Add hours — Day mode
1. **Add entry**. The panel opens in **Day** mode ("one date").
2. Choose the **date**, **hours** (e.g. `7.5`), **project** (type to search by code or name), **task**
   (required when the project has active tasks), **earning code**, and a short **description**.
3. **Save entry**. It appears in the list, the day card and the summary.

Rules you will meet: hours greater than 0 and no more than the policy maximum (24 by default), at most two
decimals; the description is required and limited in length; inactive projects/codes are not offered.

### Add hours — Week mode
In the panel switch to **Week** ("several days at once"): pick one project/task/code, then enter hours for
each day of the week and save once. It is **all or nothing**: if any day is invalid, nothing is saved and the
error points at that day. "Already logged: N h" reminds you what a day already has. Week mode only adds; it
never replaces existing entries.

### Edit or delete
Each entry has **Edit** and **Delete** (delete asks for confirmation). If someone changed the entry since you
opened it, you get a "changed elsewhere" message instead of silently overwriting. You cannot move an entry
to a different week: delete it and add a new one.

### Submit
1. **Submit week** (disabled with no entries). A dialog shows totals and an optional comment for your manager.
2. Confirm. The week becomes **Submitted** and **read-only**.
3. If a limit is exceeded (for example more hours in a day than the policy allows) you get a list of what to
   fix; nothing is submitted.

### Take a submission back (withdraw)
Submitted the wrong week, or forgot an entry? While the week still says **Submitted**, use **Withdraw
submission** (next to the status), then confirm. The week becomes a **Draft** again with all its entries, so
you can add, edit or delete and then **Submit week** again. Your manager no longer sees it in **Approvals**
meanwhile, and their review history records "Withdrawn". Once your manager has approved or rejected the week
the button is gone (an approved week is final; a rejected one is already editable).

### If your manager rejects it
Your Timesheet shows a banner: **"This week was rejected"**, the **reason**, who reviewed and when. The week
is editable again: correct it, then **Resubmit week**. Approved weeks are final.

### Your password
**Change password** (header). You need your current password and a new one of at least 12 characters (not a
common password, not containing your name or email). Other devices are signed out.

---

## 5. Manager guide

Sign in as `manager@example.test` (Morgan). Morgan manages Alex and Sam, **not** Taylor.

- **Approvals** (header; the number is weeks waiting). Filter by *Waiting for review / Approved / Rejected*
  and by week. Oldest submission first.
- **Review** opens the week: employee, every entry, their comment, and the history of earlier decisions.
- **Approve** (optional comment) or **Reject** (a reason of at least 5 characters is **required**; the
  employee sees it). Both ask for confirmation. Two people deciding at once → one wins, the other is told it
  was already decided.
- **Reports**: hours by **person, project, earning code or week** for a date range (maximum 366 days). By
  default only **Approved** weeks are counted; tick *Waiting for review* or *Rejected* to include them.
  **Drafts are never included.** **Download CSV** exports every row for the current filters.

Sign in as `manager2@example.test` (Riley): you will see only Taylor's weeks. That is the scope rule at work.

---

## 6. Administrator guide

Sign in as `admin@example.test`. **Admin** in the header opens six sections.

### 6.1 Create a user
**Admin → Users → Add user**

1. Enter **email**, **name**, **role** (Employee / Manager / Administrator) and optionally a **manager**.
2. **Create user**. A dialog shows a **temporary password — once**. Copy it and give it to the person through a
   private channel. Closing the dialog loses it for good (it is stored only as a hash). If lost, use **Reset
   password**.
3. The person signs in with the temporary password and is **forced to choose their own** before anything else
   works.

### 6.2 Manage a user
- **Edit**: name, role, manager, active/inactive. The email cannot be changed.
- **Deactivate** (untick *Active*): the person is signed out immediately and cannot sign in; their history
  stays. Reactivate any time.
- **Reset password**: issues a new temporary password and signs the person out everywhere.
- **Protections** you will bump into on purpose: you cannot change your own role, deactivate yourself or reset
  your own password; you cannot remove the **last** active administrator; a manager who still has active
  reports cannot be deactivated or demoted until those people are reassigned.
- The list has search, role and status filters and paging. *Reports* shows how many people a manager has.

### 6.3 Teams
**Admin → Teams**: create, rename, delete, and **Members** (tick people; search keeps your ticks). Teams do not
affect who approves what.

### 6.4 Projects and tasks
**Admin → Projects**: add (code, name, description), edit, deactivate. **Tasks** opens a project's tasks. When
a project has **at least one active task, employees must pick one** on every new entry. Codes are saved in
capitals and cannot be changed. Inactive items disappear from the entry form but stay on old entries.

### 6.5 Earning codes
**Admin → Earning codes**: add (code, name, **Capped / Non-capped**). Once any entry uses a code its
classification is **locked** (it would silently rewrite past totals). Add a new code instead.

### 6.6 Hour policy
**Admin → Policy**: maximum hours per **entry**, per **day** and per **week** (empty day/week = no limit) and
the description length. The entry limit applies on save; day/week limits apply when a week is **submitted**
(and every stored entry is re-checked against the current limits). **Restore defaults** returns to the
server's configured values. Existing entries are never rewritten.

### 6.7 Audit log
**Admin → Audit log**: every change above, newest first, with who did it and before/after values; filter by
kind. It records people by id and shows their *current* name, never passwords or old names. It cannot be edited.

---

## 7. Scenarios to walk through

Each scenario lists the people, the steps and what you should see.

**A. The happy path** (Alex, Morgan)
1. Alex: open the current week, add entries (Day mode, then Week mode), **Submit week**.
2. Morgan: **Approvals** shows the week → **Review** → **Approve**.
3. Alex: refresh — banner says approved and read-only; no Add/Edit/Delete.
4. Morgan: **Reports** for that week → Alex's hours appear (Approved is the default filter).

**B. Rejection and resubmission** (Alex, Morgan)
1. Alex submits. Morgan **Rejects** with reason "Please recheck Tuesday's hours."
2. Alex sees the rejection banner and reason, edits Tuesday, **Resubmit week**.
3. Morgan approves. Open the review page: the history shows submitted → rejected → submitted → approved.

**B2. Withdrawing a submission** (Alex, Morgan)
1. Alex submits a week, then notices a missing entry.
2. Alex clicks **Withdraw submission** and confirms. The status is **Draft** and Add/Edit/Delete are back.
3. Morgan: **Approvals** no longer lists the week (the page link now says "Timesheet not found").
4. Alex adds the entry and **Submit week** again. Morgan sees it again; its history reads submitted →
   withdrawn → submitted. After Morgan approves, **Withdraw submission** is gone.

**C. Onboarding a new hire** (Jordan, new person)
1. Jordan creates **new.hire@example.test** (Employee, manager Morgan) and copies the temporary password.
2. In a private window the new hire signs in → forced to **Choose a new password** → then lands on Timesheet.
3. They log and submit; the week appears for **Morgan**, not Riley.

**D. A leaver** (Jordan)
1. The new hire is signed in in another window. Jordan unticks **Active** → their window loses access on the
   next action and they cannot sign in ("Invalid email or password").
2. Reactivate them and the same password works again.

**E. A forgotten password** (Jordan)
**Reset password** for a user → new one-time password → they must change it at next sign-in; old sessions die.

**F. Changing the rules** (Jordan, Alex)
1. Jordan sets **Maximum hours in one entry** to `8`. Alex tries to save `9` → refused with the limit named.
2. Alex's already-saved 10-hour entry blocks submission until fixed.
3. Jordan **Restore defaults**. Check the **Audit log** for both changes.

**G. A manager's reach** (Morgan, Riley, Jordan)
Taylor submits. Morgan does **not** see it; Riley does; Jordan sees it. Morgan reports show only Alex and Sam.

**H. Retiring a project** (Jordan, Alex)
Add a project with a task → Alex can pick it and must choose the task. Deactivate the project → it vanishes
from Alex's entry form, but Alex's old entries still show it.

---

## 8. What you can test

Set up once for the command-line sections:

```bash
cd /Users/kanakverma/repos/timetrack
set -a && . ./.env && set +a      # exports SEED_PASSWORD, DATABASE_URL, …
```

### 8.1 UI

**By hand** (sections 4–7 are the script). Extra things worth poking at:
- **Validation:** empty form, `0`, `24.5`, `7.555` hours, over-long description; read the messages and check
  focus jumps to the error.
- **Double click** Save or Submit: only one request/entry is created.
- **Keyboard only:** Tab through a dialog, Escape closes it and returns focus to the button that opened it.
- **Small screens:** narrow the browser to ~375 px. Tables become labelled cards and nothing scrolls sideways.
- **Session expiry / sign out:** sign out in one tab, act in another → you are sent to sign-in.
- **Two windows editing the same entry:** you get a "changed elsewhere" message.

**Automated**
```bash
cd frontend
npm test                                  # 254 component tests (fetch is mocked)
npx playwright test                       # full end-to-end, Chromium + Firefox + WebKit (~8 min)
npx playwright test --project=chromium    # one browser, faster
npx playwright test reports -g "CSV"      # a subset
npx playwright show-report                # last run's HTML report
```
Playwright recreates a separate database (`timetrack_e2e`) on every run, so it never touches your dev data.
Accessibility is checked by axe inside these tests. Not covered: a real screen reader or a real phone.

### 8.2 API

Interactive docs: http://localhost:8000/api/v1/docs (good for reading the shapes). Swagger can't easily send
the required `X-Requested-With` header, so use `curl` for anything that changes data:

```bash
API=http://localhost:8000/api/v1
H='X-Requested-With: timetrack'

# sign in (cookie saved to a file)
curl -s -c jar -H "$H" -H 'Content-Type: application/json' \
  -d "{\"email\":\"employee@example.test\",\"password\":\"$SEED_PASSWORD\"}" $API/auth/login

curl -s -b jar $API/auth/me                         # who am I
curl -s -b jar $API/meta                            # business date, limits
curl -s -b jar "$API/timesheets/weeks/2026-10-19"   # a week with entries and totals
curl -s -b jar "$API/projects"                      # project ids, needed to create entries
```

Things to try and what to expect:

| Try | Expect |
| --- | --- |
| `POST` anything without the `X-Requested-With` header | 403 |
| `GET $API/approvals` as the employee | 403 |
| `GET $API/admin/users` as the employee/manager | 403; as admin 200 |
| Any call with no cookie | 401, same body for real and made-up ids |
| Unknown id (e.g. a random UUID) | 404, never a hint that it exists |
| Create an entry with 25 hours | 422 with `field_errors.hours` |
| Submit the same week twice | second returns 409 `INVALID_TRANSITION` (or 200 with the same `Idempotency-Key`) |
| `GET /reports/hours?date_from=…&date_to=…` as employee | 403 |

Every error has the same shape: `{"error": {"code", "message", "field_errors", "request_id"}}`, and the
`request_id` matches a log line in `.dev/api.log`. The full list of endpoints is in `docs/api-contracts.md`.

**Automated:** `cd backend && .venv/bin/pytest` runs 540 tests against a real PostgreSQL (a separate
`timetrack_test` database): validation matrices, authorization, concurrency (parallel requests racing),
rollback on failure, idempotency, reports, retention.

### 8.3 Database

```bash
docker exec -it timetrack-db psql -U timetrack -d timetrack
```
Useful queries (`\dt` lists tables, `\d time_entries` shows constraints):

```sql
-- hours per employee per status
select u.email, w.status, sum(e.hours)
from time_entries e join timesheet_weeks w on w.id = e.timesheet_week_id
join users u on u.id = e.employee_id group by 1, 2 order by 1, 2;

-- who approved what
select a.created_at, a.action, u.email as actor, a.comment from approval_events a
join users u on u.id = a.actor_id order by a.created_at desc limit 10;

-- admin changes (note: ids and labels only, no emails or passwords)
select created_at, entity_type, action, details from config_audit_events order by created_at desc limit 5;

-- the policy override (empty = environment defaults in force)
select * from policy_settings;
```
Things worth trying (they are **supposed to fail**):
- `update time_entries set hours = 25;` → CHECK constraint violation (hours must be above 0 and at most 24).
- `update approval_events set comment = 'x';` → error: audit rows cannot be changed. Same for `delete`, and for
  `time_entry_events` and `config_audit_events`.
- Passwords: `select email, left(password_hash, 12) from users;` shows only an Argon2id prefix.
- Sessions: `select user_id, expires_at, revoked_at from auth_sessions;` stores a digest, not the cookie value.

Schema changes are migrations (`backend/alembic/versions`). `cd backend && .venv/bin/alembic check` confirms
the models and the database agree. **Backup and restore drill** (dumps, restores into a throwaway database and
compares every table):
```bash
scripts/backup-restore-drill.sh
```

### 8.4 Performance

```bash
cd backend && .venv/bin/python scripts/perf_check.py
```
It builds a disposable database of ~15,000 entries (50 people × 52 weeks), starts a real server, times real HTTP
calls (dashboard, save, submit, approvals, admin, reports, CSV, plus 8 concurrent readers) and exits non-zero if
any p95 is over 500 ms. Results and caveats are in `docs/performance.md`. Variations to learn from:
```bash
.venv/bin/python scripts/perf_check.py --budget-ms 20          # see which calls miss a tighter budget
.venv/bin/python scripts/perf_check.py --employees 200 --weeks 104
```
Remember: one machine, loopback network, one worker. It checks the app's own cost, not production capacity.
In the browser, DevTools → Network shows each page's request count and timings.

### 8.5 Security

**Automated:** `backend/app/tests/test_security_regression.py` lists *every* route with the roles allowed and
fails if a route is missing from the list; it checks four kinds of caller on every route, CSRF and Origin on
every state-changing route, the temporary-password lockdown, production-mode headers, CORS and error leakage.
```bash
cd backend && .venv/bin/pytest app/tests/test_security_regression.py -q
.venv/bin/pip install pip-audit && .venv/bin/pip-audit --skip-editable   # Python dependency vulnerabilities
cd ../frontend && npm audit                                              # JavaScript dependencies
```

**By hand** (safe on your own machine):
- **Access control:** sign in as Alex and paste `http://localhost:5173/admin/users` or `/approvals` → "You do
  not have access". Then call `$API/admin/users` and `$API/approvals` with `curl -b jar` → 403. The page is a courtesy; the API
  is the control.
- **Scope:** as Morgan, look for Taylor's week in Approvals (absent). With `curl`, ask for it by id → 404.
- **Brute force:** fail a login five times for one email → 429 ("Too many failed attempts"). Restart the API
  (`scripts/dev-down.sh && scripts/dev-up.sh`) to reset the in-memory counter.
- **CSRF:** repeat a `POST` without `-H 'X-Requested-With: timetrack'` → 403; with a wrong `Origin` header → 403.
- **Headers:** `curl -sI http://localhost:8000/api/v1/health` shows `X-Content-Type-Options`, `X-Frame-Options`,
  `Content-Security-Policy`, `Cache-Control: no-store`, and so on.
- **Password handling:** create a user and note the temporary password appears only in that dialog — not in the
  list, the audit log, `.dev/api.log` or the database.
- **Forced change:** with the new user's temporary password, call `GET /projects` with `curl` → 403
  `PASSWORD_CHANGE_REQUIRED`.
- **Spreadsheet injection:** make a project whose name starts with `=` (e.g. `=1+1`), approve a week using it,
  export the CSV: the cell starts with `'` so Excel won't run it.
- **Deactivation:** deactivate a signed-in user; their next request fails.
- **Audit tamper:** try the `update approval_events …` statement from 8.3.

**Honest limits:** these are checks you run yourself and an engineering review (`docs/security-review.md`), not a
professional penetration test. There is no MFA/SSO, and the login throttle is in-memory.

---

## 9. When something looks wrong

| Symptom | Likely cause / fix |
| --- | --- |
| Can't sign in as a demo user | Wrong `SEED_PASSWORD`; re-run the seed script; or 5 failed attempts → restart the API |
| "Too many failed attempts" | Throttle; wait 15 min or restart the API |
| Page is blank / "Unable to reach the server" | API not running: `scripts/dev-up.sh`; logs in `.dev/api.log`, `.dev/web.log` |
| New user can only see "Choose a new password" | Expected until they change the temporary password |
| Week can't be edited | It is Submitted or Approved. Only the manager can send it back (reject) |
| "This week cannot be submitted yet" | Read the list: a day/week limit or a stored entry breaks the current policy |
| Project missing from the entry form | It is inactive, or you searched for something else |
| Start over with clean demo data | `scripts/dev-down.sh`, `docker compose down -v` (deletes the database volume), `scripts/dev-up.sh --seed` |

Deeper reading: `docs/architecture.md` (how it is built), `docs/decisions.md` (why), `docs/api-contracts.md`,
`docs/data-model.md`, `docs/testing-strategy.md`, `docs/security-review.md`, `docs/operations.md`.
