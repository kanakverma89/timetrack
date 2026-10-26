# Playwright architect: a 10-day study guide (TypeScript)

Case study: this repository (TimeTrack). Everything below points at real files you can open, run and break.

## 0. How to use this guide

**Goal.** In ten days you should be able to (a) explain how Playwright works, (b) design a test framework
and defend the trade-offs, (c) diagnose a flaky test out loud, and (d) tell four or five true stories about
real problems from this project.

**Daily rhythm (about 3 hours).**

| Block | Time | What |
| --- | --- | --- |
| Read | 30 min | the day's section |
| Do | 90 min | the exercises, **typing the code yourself** (do not paste it) |
| Say it | 30 min | answer the day's questions aloud, no notes, then compare with the appendix |
| Review | 30 min | write three lines in a notes file: what I learned, what I still cannot explain, one thing to retry tomorrow |

**Honesty rule (important for the interview).** TimeTrack is a learning project built with an AI assistant.
Say that. Interviewers respect "I built this to learn, here is what I can explain and rebuild" far more than a
claim you cannot defend. Only describe decisions you can reproduce on a whiteboard. Section 12 lists what you
can and cannot truthfully claim.

**Setup once.**

```bash
scripts/dev-up.sh            # local app (not needed for the E2E suite, which starts its own)
cd frontend
npx playwright test --list   # all tests; count them
npx playwright test tests/e2e/auth.spec.ts --project=chromium   # first run, 4 tests
```

The suite needs `SEED_PASSWORD` (it is in the repo-root `.env`) and a running PostgreSQL (`docker ps` should show `timetrack-db`).

**Repo map for testing.**

| What | Where |
| --- | --- |
| Playwright config (projects, servers, retries) | [frontend/playwright.config.ts](../frontend/playwright.config.ts) |
| Shared fixtures and helpers | [frontend/tests/e2e/fixtures.ts](../frontend/tests/e2e/fixtures.ts) |
| 14 spec files (about 130 tests) | `frontend/tests/e2e/*.spec.ts` |
| Tests against the live site | [frontend/tests/smoke/deployed.spec.ts](../frontend/tests/smoke/deployed.spec.ts) and [playwright.deployed.config.ts](../frontend/playwright.deployed.config.ts) |
| Component tests (Vitest) | `frontend/src/**/*.test.tsx` |
| Backend API tests (pytest) | `backend/app/tests/` |
| Route-by-role rule test | [backend/app/tests/test_security_regression.py](../backend/app/tests/test_security_regression.py) |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml), [deploy-verify.yml](../.github/workflows/deploy-verify.yml) |
| Strategy and decisions | [docs/testing-strategy.md](testing-strategy.md), [docs/decisions.md](decisions.md) (see D-72) |
| Every test as manual steps | `docs/e2e-test-cases.xlsx` (not committed) |

**Numbers to know (as of the last full run).** 556 backend tests, 265 component tests, 129 browser tests which
run on 3 browsers (387 runs: 380 passed, 7 skipped on purpose). A full local run takes about 7 minutes; the
CI job about 15 to 20. Playwright version 1.64, `@axe-core/playwright` 4.14.

---

## Day 1: How Playwright works (the mental model)

**Learn.**
- Three layers: your test code (Node), the test runner (`@playwright/test`: workers, fixtures, retries,
  reporters), and the browser, driven over a protocol. Chromium uses the Chrome DevTools Protocol; Firefox and
  WebKit use Playwright's patched builds with an equivalent protocol. That is why one API covers three engines.
- **Browser → context → page.** A *context* is an isolated profile (cookies, storage, permissions). Creating
  one is cheap, so each test gets its own. This is the foundation of test isolation.
- **Auto-waiting.** Before an action Playwright waits until the element is attached, visible, stable (not
  animating), able to receive the click (not covered) and enabled (and editable for `fill`). You do not write
  sleeps.
- **Web-first assertions** (`expect(locator).toBeVisible()`) retry until they pass or the expect timeout
  (default 5 s) runs out. Plain `expect(await locator.isVisible())` does *not* retry. That one difference
  causes most flaky tests.
- **Strict mode.** A locator that matches several elements throws when you act on it. This is a feature: it
  stops you clicking the wrong thing.
- Timeouts: test (30 s default), expect (5 s), action and navigation (none by default, bounded by the test).

**In this repo.**
- [fixtures.ts](../frontend/tests/e2e/fixtures.ts), `pageFor`: a second *context* with its own cookies, so a
  manager and an employee are two real sessions at once.
- [auth.spec.ts](../frontend/tests/e2e/auth.spec.ts): read all four tests; they are the simplest examples.

**Exercises.**
1. Run `npx playwright test tests/e2e/auth.spec.ts --project=chromium --ui`. Watch each action and use the
   time-travel snapshots.
2. Run it with `--debug` and step through the login test.
3. Write a new spec `tests/e2e/day1.spec.ts` that signs in through the form and checks the heading. Then
   deliberately write `expect(await page.getByRole('heading').isVisible()).toBe(true)` right after a click
   and explain why it can fail while `toBeVisible()` cannot.
4. In the Playwright trace viewer (`npx playwright show-trace <trace.zip>`), find the "Before" and "After"
   DOM snapshots for one click.

**Say it aloud.** What is the difference between a browser, a context and a page? Why is a context per test
better than a browser per test? What does "auto-waiting" actually check?

---

## Day 2: Locators and assertions (readable, resilient)

**Learn.**
- Preference order: `getByRole` (with `name`) → `getByLabel` → `getByText` → `getByPlaceholder` → `getByTestId`
  → CSS/XPath last. Role-based locators double as an accessibility check: if you cannot find a control by role
  and name, a screen reader user cannot either.
- Chaining and filtering: `.filter({ hasText })`, `.nth()`, `.first()`; scoping inside a container.
- `expect(locator)` matchers: `toHaveText`, `toContainText`, `toHaveCount`, `toHaveValue`, `toBeEnabled`,
  `toBeFocused`, `toHaveAttribute`, `toHaveURL`. For things that are not locators: `expect.poll(fn)` and
  `expect(async () => {...}).toPass()`.
- Anti-patterns: `waitForTimeout`, brittle CSS paths, XPath by position, asserting on implementation details.
- `data-testid` is a fallback for things with no accessible name; this app has a few (`day-card`, `entry-card`,
  `approval-row`).

**In this repo.** Open [entries.spec.ts](../frontend/tests/e2e/entries.spec.ts) and read `panel`, `openAdd`,
`chooseProject`, `fillEntry`: small local helpers that return locators. Note how `getByRole('combobox', { name:
/^Project/ })` is used.

**Exercises.**
1. List three locators in the repo that use `getByTestId`. For each, write down whether a role or label locator
   would work instead (and why the author chose a test id).
2. Rewrite five CSS-based locators of your own invention into role-based ones.
3. Write a test that proves the week total on the dashboard equals the sum of the day cards. Use only
   web-first assertions.
4. Start the app with `scripts/dev-up.sh`, then run `npx playwright codegen http://localhost:5173` and compare what codegen produces with how the repo writes the same step.
   Note what you would change.

**Say it aloud.** Why prefer `getByRole`? When is a test id justified? What does strict mode protect you from?

---

## Day 3: Test design: fixtures, page objects, data setup

**Learn.**
- **Fixtures** are Playwright's dependency injection. `test.extend({...})` adds named, lazily created
  resources with setup before `await use(value)` and teardown after. Scopes: `test` (default) and `worker`.
  Only fixtures a test asks for are created.
- **Page Object Model vs fixtures + helper functions.** POM groups selectors and actions per page. It helps
  when many tests share complex pages, but it grows into a second application. This repo chose small helper
  functions plus fixtures (decision worth being able to defend, and to argue the other side of).
- **Set up through the API, test through the UI.** Creating data by clicking is slow and fragile. Create it by
  API and spend the browser on the behaviour you are actually verifying.
- **Authentication reuse.** Two options: `storageState` (log in once in a setup project, reuse the file) or
  sign in per test through the API (what this repo does: it is a few milliseconds and needs no stale files).

**In this repo.**

```ts
// frontend/tests/e2e/fixtures.ts (simplified)
export const test = base.extend<{ employeePage: Page; managerPage: Page /* ... */ }>({
  employeePage: async ({ page }, use) => {
    await signInViaApi(page.request, EMPLOYEE); // the cookie lands in the page's own context
    await use(page);
  },
  managerPage: async ({ browser, baseURL }, use) => {
    const { page, close } = await pageFor(browser, baseURL, MANAGER); // a second, separate session
    await use(page);
    await close(); // teardown
  },
});
```

Read `createEntryViaApi`, `submittedWeek`, `submitViaApi`, `setWeekStatus` (which changes status directly in the
database through a small script, for states the UI cannot reach quickly), and `refs`.

**Exercises.**
1. Add a fixture `employee2Page` for `employee2@example.test`. Use it in a new test that proves Sam cannot see
   Alex's week (compare with the isolation test in [dashboard.spec.ts](../frontend/tests/e2e/dashboard.spec.ts)).
2. Write the same "add an entry" flow twice: once as a page object class, once as helper functions. List three
   pros and cons of each.
3. Convert one repo test from UI-driven setup to API setup (or the reverse) and time both with
   `--reporter=list`.
4. Make a **worker-scoped** fixture that prints the worker index once per worker. Run with `--workers=3` and
   see how many times it runs.

**Say it aloud.** Fixtures versus page objects: your position and why. What is lazily created? Where do you
put teardown? When do you use `storageState` and when not?

---

## Day 4: Isolation, parallelism and test data (the heart of scale)

**Learn.**
- Playwright runs **files in parallel** across worker processes by default; `fullyParallel: true` also
  parallelises tests *within* a file (this repo sets it). `workers` defaults to about half the CPU cores.
- Tests must not depend on order or share mutable state. If they must, say so explicitly:
  `test.describe.configure({ mode: 'serial' })` (one fails, the rest skip, and the group retries together).
- **Data isolation strategies:** unique data per test (names, emails), a reserved slice of data per test, a
  fresh database per run, a fresh tenant per test, or transaction rollback. Each has a cost.
- **Shared-configuration tests** (they change global settings) cannot run beside others. Put them in their own
  *project* that runs after the rest, using project `dependencies`.
- State that cannot be reset (a submitted week is locked) means retries and `--repeat-each` need fresh data.

**In this repo (a real design, study it closely).**
- Disposable database: the config's `webServer` runs `prepare_db.py timetrack_e2e --seed` and then the API, on
  port 8100, with `reuseExistingServer: false`. Every run starts clean.
- **Reserved weeks.** `weekFor(key, project, attempt)` derives a far-future week from the test's key, the
  browser and the retry number, so no two tests (or browsers, or retries) ever share one. New tests add a key
  to `WEEK_KEYS`; append only, because the slot depends on position.
- **Admin projects.** Specs named `admin-*.spec.ts` change policy, catalogue and users. They run only in
  `admin-chromium → admin-firefox → admin-webkit`, each depending on the previous, after every other project.
  Decision D-72 in [decisions.md](decisions.md) explains why.
- `LOGIN_MAX_ATTEMPTS=1000` in the test server: the API's login throttle would otherwise lock out tests that
  sign in repeatedly from one address. A test environment adjusted on purpose, documented in the config.

**Exercises.**
1. Run the suite with `--workers=1`, then `--workers=4`. Compare time. Find the slowest spec.
2. Break isolation on purpose: make two tests in a copy of [submission.spec.ts](../frontend/tests/e2e/submission.spec.ts)
   use the same week key. Run in parallel and watch what fails. Explain it.
3. Run `npx playwright test tests/e2e/withdrawal.spec.ts --project=chromium --repeat-each=2`. It fails in the
   second repeat. Explain exactly why (hint: `testInfo.retry` versus repeat index) and write down two ways to fix
   it. (This was a real mistake made during this project.)
4. Remove `dependencies` from `admin-chromium` in a scratch copy of the config and run everything. What is
   the risk? Which tests could break?

**Say it aloud.** How do you make tests independent when they share a database? When is `serial` acceptable?
What are the trade-offs of a fresh database per run versus per test?

---

## Day 5: Debugging and flaky tests (the favourite interview topic)

**Learn.**
- Tools: UI mode (`--ui`), `--debug`, trace viewer, `page.pause()`, screenshots, video, console and network logs,
  `--last-failed`, `--repeat-each` (for stateless tests), `--workers=1` to separate load problems from logic.
- Trace modes: `on`, `off`, `on-first-retry`, `retain-on-failure` (this repo's choice; CI uploads the HTML
  report on failure).
- **Flake triage ladder.** (1) Does it fail alone? (2) Does it fail on one browser or OS only? (3) Does it fail
  only in parallel or only after another test? (4) Is a wait missing, or an assertion non-retrying? (5) Is
  data shared? (6) Is the app genuinely racy (then it is a *product* bug)? Never "fix" by adding a sleep or
  raising a timeout before you know which of these it is.
- `test.slow()` triples the timeout; a legitimate response to heavy tests under load, but record why.
- A test that **cannot fail** is worse than none. Prove each test by breaking the code it guards (a *mutation
  check*) and watching it fail. This project did that routinely.

**Real incidents from this project (learn to tell them).**

| Incident | What happened | Lesson |
| --- | --- | --- |
| **Linux-only contrast failure** (see Story 1) | an axe check failed on CI WebKit, never locally | reproduce on the same OS; make failures print the element; the cause was a CSS transition caught half-way |
| **A test that passed without the fix** | a jsdom unit test for a redirect bug passed even with the bug present | a green test proves nothing until you have seen it red; the real-browser test reproduced it |
| **`--repeat-each` failures** | the same test failed on the second repeat | state that cannot be reset needs fresh data per attempt (`testInfo.retry`), not per repeat |
| **Firefox timeouts under load** | an axe-heavy test timed out in the full run, passed alone in 10 s | it was load, not logic; `test.slow()` with a comment. I also removed a decorative blur in case it was a factor, and that was *not* proven |
| **WebKit does not Tab to form controls on macOS** | keyboard test fails only there | a real browser difference, handled with `test.skip(browserName === 'webkit', reason)` and a written reason |
| **Mobile menu overflow** | a 375 px test found sideways scrolling | tests at small widths find real product defects |

**Exercises.**
1. Make a test flaky on purpose: add a `waitForTimeout(100)` instead of an assertion on an element that takes
   about 300 ms to appear (throttle with `page.route` and a delay). Run it 20 times. Fix it properly.
2. Take any test and run a **mutation check**: break the product code it is meant to guard (comment out a
   guard in the backend route, or rename a button), confirm the test fails with a useful message, then restore.
   Do it for three tests and write down the result.
3. Open a failing trace (cause one) and find: the failing action, the network call just before it, and the
   console errors.
4. Write your own flake-triage checklist on one page, from memory, and compare with the ladder above.

**Say it aloud.** A test fails one run in twenty. Walk me through what you do. How do you decide between
fixing the test, fixing the app and quarantining? Why is "just add a wait" almost always wrong?

---

## Day 6: Configuration, CI and speed

**Learn.**
- Config essentials: `projects` (browsers, viewports, auth states), `webServer` (start the app for the run),
  `retries`, `workers`, `reporter`, `use` (baseURL, trace), `testMatch`/`testIgnore`, `dependencies`,
  `globalSetup` (but prefer project dependencies; they show up in the report).
- **CI shape.** Install browsers (`npx playwright install --with-deps`), run, upload the report on failure.
  Pin an OS or use Microsoft's Playwright Docker image so local and CI agree. Visual snapshots differ across
  operating systems, so keep baselines per platform.
- **Speed.** More workers; run only what changed (`--only-changed`); **sharding** (`--shard=1/4` across
  machines, then merge with the `blob` reporter and `npx playwright merge-reports`); API setup instead of UI
  setup; one browser on every PR and all three nightly; skip heavy suites on docs-only changes.
- **Tags and filters.** `@smoke` in titles with `--grep`, or annotations.
- **Reporting.** `html`, `list`, `junit`, `blob`; attach artefacts only on failure to save storage.

**In this repo.**
- [ci.yml](../.github/workflows/ci.yml): `backend` (Python 3.12 and 3.14), `frontend` (Node 22, 24, 26), then
  `e2e` which needs both, runs against a PostgreSQL service container and all three browsers, retries once and
  uploads the report on failure.
- [deploy-verify.yml](../.github/workflows/deploy-verify.yml) and the deployed config: one worker, 3-minute
  timeout for the first request (a sleeping free-tier server), no retries, non-destructive.
- Note what CI does **not** do: it does not deploy. Vercel and Render deploy from `main` on their own.

**Exercises.**
1. Run `npx playwright test --project=chromium --shard=1/3` and again for 2/3 and 3/3. Add the times; compare
   with the unsharded run.
2. Write (do not run) the GitHub Actions matrix that shards the E2E job into 4 machines and merges the blob
   reports. Compare with the Playwright documentation.
3. Add a `@smoke` tag to five tests and run only those with `--grep @smoke`. Decide which tests deserve it and
   defend the choice.
4. Look at the CI run history (`gh run list`). Find the slowest job. Propose two ways to cut its time and the
   risk of each.

**Say it aloud.** Your suite takes 60 minutes. How do you get it to 15? How do you decide what runs on every
pull request? How do you keep local and CI results identical?

---

## Day 7: API testing, network control and non-functional checks

**Learn.**
- **API testing** with the `request` fixture (`APIRequestContext`): the same cookies, base URL and
  assertions, no browser. Use it for contracts, authorization matrices, validation and set-up.
- **Network control.** `page.route()` to mock, delay or fail a response; `waitForResponse` to sync on a call;
  HAR replay. Use it for error states that are hard to produce (500s, timeouts).
- **Multi-user** tests use multiple contexts.
- **Non-functional.** Accessibility with axe (a scan finds about a third of real problems; keep manual checks),
  security headers and cookie flags, console-error budgets, performance budgets, responsive widths, locale and
  timezone emulation, `page.clock` to control time.
- **Know the limits.** Do not test business-rule permutations through the browser. This project proves rules
  in 556 backend tests and uses the browser for flows, integration and what only a browser can show.

**In this repo.**
- [deployed.spec.ts](../frontend/tests/smoke/deployed.spec.ts) is a good API-level suite (401/403/404,
  CSRF, cookie flags, header checks, a bundle scan for secrets).
- `expectNoAxeViolations` in fixtures: tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`; the failure
  message now names the element and its colours.
- [withdrawal.spec.ts](../frontend/tests/e2e/withdrawal.spec.ts): two sessions, an API refusal and a stale-page
  case in one file.

**Exercises.**
1. Create `frontend/tests/api/auth.api.spec.ts` with a config project of its own and write 10 tests: login
   success and failure, 401 without a session, 403 without the CSRF header, 404 for a made-up id.
2. Use `page.route` to make `/api/v1/meta` return 500. What does the app show? Write the test and assert the
   retry button works when the route is removed.
3. Mock a slow response (3 seconds) and assert the loading skeleton appears and then disappears.
4. Use `page.clock` to set "today" and assert the dashboard marks the right day. (Check the app first: it takes
   today from the server, so decide what that implies.)

**Say it aloud.** What do you test at API level instead of UI level? How do you test an error that is hard to
trigger? What can axe not find?

---

## Day 8: Strategy and architecture (think like an architect)

**Learn.**
- **Test pyramid and its modern variants.** Many fast unit tests, fewer integration/API tests, a thin layer of
  end-to-end tests for critical journeys. Decide per behaviour: *what is the cheapest test that would fail if
  this broke?*
- **Risk-based selection.** Rank journeys by business impact and change frequency. Not everything deserves an
  E2E test.
- **Framework design principles.** Tests read like requirements; helpers hide mechanics not intent; one way to
  do each thing; no logic in tests; small public surface; conventions enforced by lint and review.
- **Governance.** A definition of done that includes tests; a flake budget and an owner; a quarantine policy
  with an expiry; a review checklist; onboarding notes; ADRs (decisions written down, as in `decisions.md`).
- **Metrics that matter:** time to feedback, flake rate, escaped defects, coverage of critical journeys (not
  line coverage), maintenance cost per test.
- **Build versus buy; Playwright versus Cypress and Selenium.** Be fair: Playwright gives multi-browser,
  multi-context, auto-wait, tracing and API testing in one tool; Selenium has the widest language and grid
  history; Cypress runs in the browser with a strong developer experience but a different model (no multiple
  browser contexts in one test).
- **Migration strategy** (e.g. Selenium → Playwright): inventory, tag by risk, migrate the highest-value
  journeys first, run both in parallel for a period, delete the old tests once trusted.
- **AI-assisted testing:** useful for drafts and exploration; the human owns the oracle (what "correct" is),
  and every generated test must be seen failing before it is trusted.

**In this repo.**
- [testing-strategy.md](testing-strategy.md): read the layer table. Notice what each layer is *for*.
- The security regression test: a policy enforced by a test that fails when a new route is not classified.
  This is "making the right thing the only thing".
- `docs/implementation-report.md`: each phase records what was verified, defects found by tests, and what
  was **not** verified. Honest reporting is an architect habit.

**Exercises.**
1. Take ten behaviours of the app (for example "hours over 24 are refused", "a manager cannot approve their own
   week", "the nav badge shows pending approvals", "CSV escapes formulas"). For each, decide unit, API or E2E,
   and write one sentence of justification. Compare with where this repo actually tests them.
2. Write a one-page **test strategy** for a new product with 5 teams and 3,000 planned tests. Include layers,
   data approach, environments, CI, ownership and metrics.
3. Write a **review checklist** (10 points) for pull requests that add E2E tests.
4. Write an ADR (context, decision, consequences) for "fixtures and helpers instead of page objects".

**Say it aloud.** How do you decide what to automate? What would you do in your first 30 days as architect on a
team with 2,000 flaky tests? How do you convince a team to delete tests?

---

## Day 9: Mock interviews and whiteboards

Spend the day *speaking*. Record yourself or use a friend. For every question: 90 seconds, structured
(situation, approach, trade-offs, example from this project).

**Whiteboards to rehearse (draw boxes and arrows).**
1. Design a Playwright framework for an enterprise web app with 5 teams, 3,000 tests, 3 environments.
2. A 60-minute pipeline must become 15. Where do you look first?
3. Test a feature involving two users in real time (an approval flow). How do you structure data and sessions?
4. Migrate 800 Selenium tests. Plan, sequence, risks.
5. Triage a suite with a 12% flake rate.
6. Testing a multi-tenant SaaS: isolation of tenants and of test data.

**Behavioural prompts.** Tell me about a flaky test you fixed. A time a test gave false confidence. A time you
pushed back on automating something. How you influence developers who ignore failing tests. How you mentor.

Use the question bank (Appendix A) and the stories (Appendix B).

---

## Day 10: Consolidate

1. Re-run the full suite once (`npx playwright test`) and read the report end to end.
2. Re-do from memory, with no notes: one fixture, one multi-user test, the flake-triage ladder, the sharding
   workflow.
3. Rehearse the four stories until each takes two minutes.
4. Write your one-page "How I would design a Playwright architecture" and read it aloud.
5. Prepare three questions to ask the interviewer (their flake rate, who owns the framework, how failures are
   triaged).

**You are ready when you can, without notes:**
- explain browser, context, page and auto-waiting in two minutes;
- justify fixtures over page objects and also argue the opposite;
- describe three data-isolation strategies and when each fails;
- walk through a flaky test investigation using a real example;
- cut a slow pipeline with specific techniques;
- state clearly what this project is and is not.

---

## Appendix A: Question bank with outline answers

**Core Playwright**
1. *How does auto-waiting work?* Before each action it checks the element is attached, visible, stable, can
   receive events and is enabled (editable for `fill`), retrying until the action timeout. Assertions on
   locators retry until the expect timeout.
2. *Locator vs ElementHandle?* A locator is a re-evaluated description, resilient to re-renders; a handle is a
   reference to one DOM node that goes stale. Prefer locators.
3. *Why `getByRole`?* It mirrors how users and assistive technology find things, survives markup changes, and
   doubles as an accessibility check.
4. *What is a browser context?* An isolated profile: cookies, storage, permissions. One per test gives
   isolation cheaply; several in one test model several users.
5. *Explain fixtures.* Lazy, dependency-injected resources with setup and teardown around `use`; scopes `test`
   and `worker`; composable with `extend`.
6. *`page.waitForTimeout` — when?* Practically never; wait for a condition (an assertion, a response, a URL).
7. *How do you handle iframes, new tabs, downloads, file uploads, dialogs?* `frameLocator`, `context.waitForEvent
   ('page')`, `waitForEvent('download')`, `setInputFiles`, `page.on('dialog')`. (This repo's CSV test uses the
   download event.)
8. *How do you wait for a network call?* `page.waitForResponse` started *before* the click, or assert on the
   resulting UI instead.

**Design and scale**
9. *Page objects or not?* Depends: POM for large stable UIs with many authors; fixtures and helpers for
   leaner suites. This repo uses helpers and fixtures; the risk is duplication, the benefit is less indirection.
10. *How do you share login?* API login per test (fast and always fresh) or `storageState` from a setup
    project. Avoid sharing a mutable session across parallel tests.
11. *How do you manage test data?* API set-up, unique or reserved data per test, disposable database per run;
    explain the trade-offs (speed, realism, cost, cleanup).
12. *How do you run tests that change global settings?* Isolate them in a separate project that runs after
    others, serially (this repo: admin projects, D-72).
13. *Serial mode?* Only for genuinely ordered flows; one failure skips the rest, so keep groups small.
14. *How do you test several users interacting?* Multiple contexts with their own sessions and clear
    ownership of data (this repo: employee and manager pages).
15. *Cross-browser strategy?* All three browsers for the full suite nightly or on merge; one browser on each
    pull request; document browser-specific skips with reasons.

**Reliability**
16. *Define a flaky test and your policy.* A test that passes and fails without code changes. Track the rate,
    assign an owner, quarantine with an expiry, fix root cause; never silence by default retries.
17. *Retries: good or bad?* A safety net and a detector; always report tests that passed only on retry.
18. *A test passes locally and fails in CI.* Differences: OS, fonts, speed, parallelism, data, timezone,
    headless. Reproduce in the same container; add diagnostics; compare traces. (Story 1.)
19. *How do you prove a test is useful?* Mutation check: break the code, see it fail.
20. *What causes most flakiness?* Non-retrying assertions, missing waits on state not UI, shared data, animations
    and transitions, time and timezone dependence, third-party calls.

**CI and speed**
21. *Sharding?* Split by test across machines (`--shard=i/n`), upload blob reports, merge into one report.
22. *Reduce pipeline time?* Parallelise, shard, API set-up, cache dependencies and browsers, run affected tests
    only, move checks lower in the pyramid, one browser per PR.
23. *Which reporters and artefacts?* HTML for people, JUnit for dashboards, blob for merging; traces and
    screenshots on failure only.
24. *Docker for tests?* Use the official Playwright image so the OS and browser builds match everywhere.

**Quality and strategy**
25. *What should *not* be an E2E test?* Pure logic, permutations, anything a unit or API test proves faster.
26. *Visual testing?* `toHaveScreenshot` with per-OS baselines, stable data, masked dynamic regions; useful for
    design systems, noisy for fast-moving UIs.
27. *Accessibility automation?* axe catches a subset; combine with keyboard tests and manual checks.
28. *API vs UI tests?* API for rules and contracts, UI for journeys; both use the same auth model.
29. *Metrics?* Time to feedback, flake rate, escaped defects, critical-journey coverage, cost per test.
30. *How do you introduce Playwright to a team?* A pilot on one journey, shared conventions and fixtures,
    training sessions, a review checklist, and a measured comparison.

**Leadership**
31. *Developers ignore failing tests. What do you do?* Make failures cheap to read (names, traces), make
    ownership clear, block merges on stable suites, and fix flakiness first so red means real.
32. *How do you handle disagreement on tooling?* A short experiment with agreed criteria, written as an ADR.

---

## Appendix B: Stories from this project (rehearse each in 2 minutes)

Use the shape **situation → what I assumed → how I found the truth → what I changed → how it stays fixed**.

**Story 1: the Linux-only contrast failure.** After merging a new Withdraw button, CI failed one WebKit test
(accessibility contrast) that passed on my machine. I first suspected the toast notification covering the page; a
test of that theory found nothing. I changed the helper to print the element and its colours, and ran only that
test on a GitHub runner. It reported the Withdraw button measured against a *green* background: React had
reused the Submit button's element and a 0.12 s colour transition was caught half-way on the slower machine.
Fix: a different `key` so the element is replaced, not restyled. Guard: failures now name the element, and the
fix is verified on Linux and in a full green run. *Lessons:* reproduce in the failing environment; add
diagnostics before guessing again; slow machines expose real animation behaviour.

**Story 2: the test that passed without the fix.** A redirect bug (the next user landed on the previous user's
admin page) first got a jsdom unit test that passed even before the fix. I treated that as a defect in the test,
replaced it with a deterministic test of the mechanism, and added a real-browser test that reproduced the bug
and now guards it. *Lesson:* never trust a test you have not seen fail.

**Story 3: isolating tests that change global rules.** Admin tests change shared policy and catalogue, which would
break parallel tests that rely on them. The config runs them in separate projects, one browser after another,
after everything else, with documented reasoning (D-72). *Lesson:* make the isolation structural, not a convention.

**Story 4: `--repeat-each` and state that cannot be reset.** Repeating a submit test failed the second time:
submitted weeks lock. Data is derived per retry (`testInfo.retry`), not per repeat. *Lesson:* know which tests
are stateless before you stress them, and say so in the test.

**Story 5 (optional): a rule that cannot be skipped.** A test lists every API route and who may call it, and fails
when a route is unclassified. Adding the Withdraw route stopped the first run until it was classified.
*Lesson:* turn policies into tests.

---

## Appendix C: Cheat sheet

```ts
// config: project with dependency, web server, trace
projects: [{ name: 'setup', testMatch: /.*\.setup\.ts/ },
           { name: 'chromium', use: devices['Desktop Chrome'], dependencies: ['setup'] }],
webServer: { command: 'npm run dev', url: 'http://localhost:5174', reuseExistingServer: !process.env.CI },
use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },

// fixtures
export const test = base.extend<{ asManager: Page }>({
  asManager: async ({ browser }, use) => { const ctx = await browser.newContext(); /* sign in */ await use(await ctx.newPage()); await ctx.close(); },
});

// waits and assertions
await expect(page.getByRole('status')).toContainText('saved');
await expect.poll(async () => (await api.get('/x')).status()).toBe(200);
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'CSV' }).click()]);

// network
await page.route('**/api/v1/meta', (route) => route.fulfill({ status: 500, body: '{}' }));

// API testing
const res = await request.post('/api/v1/auth/login', { headers: { 'X-Requested-With': 'timetrack' }, data: { email, password } });
expect(res.status()).toBe(200);

// run
npx playwright test --project=chromium --grep @smoke --workers=2
npx playwright test --ui | --debug | --last-failed | --shard=1/4 | --reporter=blob
npx playwright show-trace test-results/<test>/trace.zip
npx playwright merge-reports ./blob-reports --reporter=html
```

---

## 12. What you can and cannot truthfully claim

**You can say:** "I built a full-stack timesheet application as a learning project with an AI assistant, and
used it to study test architecture. The suite has about 130 end-to-end tests on three browsers, 265 component
tests and 556 backend tests. I can explain how the data isolation, the admin project ordering, the fixtures and
the CI pipeline work, and I can describe real failures I diagnosed."

**Do not say:** that you wrote it all alone, that it is in production use by a team, that you ran it at scale
(the free-tier demo has a handful of users), or that you have used sharding or visual regression here (neither
is in this repo; if you want to claim them, do Day 6 exercise 1 and Day 7 yourself first).

**Gaps in this repo to be upfront about:** no sharding, no visual snapshot tests, no `storageState`, no
`@smoke` tags, no API test folder yet, no component-level Playwright tests, and it has only been run on GitHub's
`ubuntu-24.04` and a Mac. Turning the exercises into real commits fills these gaps truthfully.
