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

## Results (2026-10-24)

Dataset: 50 employees × 52 weeks = 15,161 entries. Machine: macOS (Apple silicon, 8 CPUs), Python
3.14.7, PostgreSQL 16 in Docker on the same machine, 1 uvicorn worker. Two consecutive runs; the
second run is shown, the first differed by at most a few milliseconds at p95.

| Endpoint | n | p50 ms | p95 ms | p99 ms | max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| `GET /meta` | 100 | 3.0 | 4.0 | 5.7 | 17.2 |
| `GET /projects` | 100 | 3.8 | 4.1 | 4.3 | 4.4 |
| **`GET /timesheets/weeks/{date}` (dashboard)** | 300 | 5.7 | **6.8** | 11.9 | 20.6 |
| **`POST /time-entries` (save entry)** | 150 | 9.1 | **10.9** | 12.2 | 22.3 |
| `PATCH /time-entries/{id}` | 150 | 8.3 | 9.6 | 11.3 | 19.9 |
| `POST /time-entries/batch` (5 days) | 100 | 21.0 | 30.2 | 33.7 | 57.3 |
| `DELETE /time-entries/{id}` | 150 | 7.1 | 10.4 | 13.6 | 17.7 |
| `GET` week, 8 concurrent clients | 480 | 22.0 | 47.1 | 60.2 | 73.3 |

Both spec targets are met by roughly two orders of magnitude (dashboard p95 6.8 ms and save p95
10.9 ms against 500 ms). No caching, background workers or query tuning were needed, consistent
with the spec's "measure before optimising".

## What this does not show

- **Network and browser time.** Requests go over loopback; real latency, TLS and rendering are extra.
- **Production sizing.** One worker, one machine, a PostgreSQL container sharing the CPUs. Heavier
  concurrency, larger datasets (years × thousands of employees) and a managed database were not
  tested.
- **Login.** One Argon2id login per run is not part of the percentiles; hashing is deliberately slow
  (tens of milliseconds) and is rate-limited.
- **Submission** (Phase 5) and manager lists (Phase 6, which need pagination) are not yet covered.
- The script is not part of CI because timings on shared runners are too noisy to gate on.
