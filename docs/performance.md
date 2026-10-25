# Performance

Spec §4.2 sets initial targets for local/staging testing: dashboard API and entry-save API **p95
under 500 ms** with a realistic development dataset. This document records how that is measured and
what was measured. It is a regression check on the application's own cost, **not** a capacity or
production-sizing claim.

## How to run

```bash
cd backend && set -a && . ../.env && set +a
.venv/bin/python scripts/perf_check.py              # exits non-zero if any p95 > 500 ms
.venv/bin/python scripts/perf_check.py --budget-ms 100 --employees 200 --weeks 104
```

The script recreates the disposable database `timetrack_perf_test`, migrates it, loads synthetic
employees × weeks of entries (default 50 × 52 ≈ 15,000 entries over 52 weeks, mixed projects, tasks
and earning codes), runs `ANALYZE`, starts a real `uvicorn` process (one worker, access log off) and
times real HTTP requests from one employee's session. Endpoint samples run sequentially; the last
row uses 8 concurrent clients. The destructive helpers only accept database names ending in `_test`
or `_e2e`.

## Results (2026-10-24, with Phase 7)

Dataset: 50 employees × 52 weeks = 15,451 entries. Machine: macOS (Apple silicon, 8 CPUs), Python
3.14.7, PostgreSQL 16 in Docker on the same machine, 1 uvicorn worker. Two consecutive runs; the
second run is shown, the first differed by at most a few milliseconds at p95 (the largest gap was the
concurrent-read row, 32.0 vs 38.5 ms).

| Endpoint | n | p50 ms | p95 ms | p99 ms | max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| `GET /meta` | 100 | 4.1 | 4.7 | 4.8 | 5.0 |
| `GET /projects` | 100 | 4.2 | 4.7 | 6.0 | 13.3 |
| **`GET /timesheets/weeks/{date}` (dashboard)** | 300 | 5.6 | **6.1** | 10.7 | 22.6 |
| **`POST /time-entries` (save entry)** | 150 | 9.2 | **10.8** | 12.6 | 23.3 |
| `PATCH /time-entries/{id}` | 150 | 8.5 | 9.8 | 11.4 | 13.1 |
| `POST /time-entries/batch` (5 days) | 100 | 22.0 | 27.8 | 29.6 | 30.3 |
| `DELETE /time-entries/{id}` | 150 | 7.1 | 9.4 | 10.4 | 10.9 |
| `POST /timesheets/weeks/{date}/submit` | 100 | 10.0 | 11.7 | 15.5 | 24.5 |
| `GET /approvals` (waiting) | 100 | 11.4 | 15.8 | 20.1 | 23.2 |
| `GET /approvals` (approved, deep paging) | 100 | 15.0 | 18.7 | 19.9 | 21.7 |
| `GET /approvals/{id}` (review page) | 100 | 7.7 | 10.7 | 12.4 | 14.4 |
| `POST /approvals/{id}/approve` | 100 | 10.2 | 12.5 | 13.3 | 18.0 |
| `GET /admin/users` (page of 20) | 100 | 6.5 | 8.1 | 9.7 | 13.7 |
| `GET /admin/users?search=` | 100 | 6.4 | 7.4 | 8.8 | 17.6 |
| `GET /admin/projects` | 100 | 4.9 | 5.6 | 6.9 | 18.8 |
| `GET /admin/policy` | 100 | 3.9 | 4.1 | 4.6 | 9.1 |
| `PUT /admin/policy` | 50 | 7.2 | 7.9 | 9.4 | 9.4 |
| `POST /admin/users` (includes Argon2id hashing) | 30 | 46.3 | 63.9 | 72.9 | 72.9 |
| `PATCH /admin/users/{id}` | 30 | 7.5 | 9.3 | 10.4 | 10.4 |
| `GET /admin/audit` (page of 20) | 100 | 6.0 | 6.6 | 7.1 | 7.6 |
| `GET /reports/hours` (admin, by person, 52 weeks) | 30 | 40.7 | 45.0 | 50.8 | 50.8 |
| `GET /reports/hours` (admin, by project) | 30 | 45.7 | 48.1 | 49.4 | 49.4 |
| `GET /reports/hours` (admin, by earning code) | 30 | 45.6 | 47.3 | 53.8 | 53.8 |
| `GET /reports/hours` (admin, by week) | 30 | 60.5 | 64.8 | 104.1 | 104.1 |
| `GET /reports/hours` (manager, by person) | 30 | 40.7 | 42.2 | 47.0 | 47.0 |
| `GET /reports/hours.csv` (admin, by person) | 30 | 41.5 | 44.8 | 46.0 | 46.0 |
| `GET` week, 8 concurrent clients | 480 | 20.1 | 38.5 | 46.6 | 52.5 |

Both spec targets are met by roughly two orders of magnitude (dashboard p95 6.1 ms and save p95
10.8 ms against 500 ms). The reports are the heaviest reads (about 45–65 ms at p95) because each one
aggregates a year of the ~15,000 entries in SQL; they are still well inside the budget, and need no
caching. No caching, background workers or query tuning were needed, consistent with the spec's
"measure before optimising".

## What this does not show

- **Network and browser time.** Requests go over loopback; real latency, TLS and rendering are extra.
- **Production sizing.** One worker, one machine, a PostgreSQL container sharing the CPUs. Heavier
  concurrency, larger datasets (years × thousands of employees) and a managed database were not
  tested.
- **Login.** One Argon2id login per run is not part of the percentiles; hashing is deliberately slow
  (tens of milliseconds) and is rate-limited.
- Notification delivery (a background task after the response) is not timed. The manager list runs
  against about 2,500 reviewed weeks for one manager; a very large organisation is untested. The
  report timings cover one year of 50 people; a report over many years and thousands of employees is
  untested, and an export is capped at 100,000 rows rather than measured beyond that.
- The script is not part of CI because timings on shared runners are too noisy to gate on.
