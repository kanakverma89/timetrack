"""Measure API latency against the spec's targets (§4.2) on a realistic synthetic dataset.

    python scripts/perf_check.py [--budget-ms 500] [--employees 50] [--weeks 52]

Builds a disposable database (``timetrack_perf_test``), loads about employees x weeks x 7 entries,
starts a real uvicorn server, and times real HTTP requests from one employee's session. Exits
non-zero if any p95 exceeds the budget. This is a single-machine measurement (no network latency,
one server worker, local PostgreSQL): it checks the application's own cost and query shapes, not
production capacity.
"""

from __future__ import annotations

import argparse
import os
import platform
import random
import statistics
import subprocess
import sys
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
from sqlalchemy import insert, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import make_engine
from app.db_admin import recreate_database, upgrade_database
from app.models import (
    EarningCode,
    Project,
    ProjectTask,
    TimeEntry,
    TimesheetWeek,
    User,
    WeekStatus,
)
from app.models.user import Role
from app.security.passwords import hash_password
from app.seeding import seed

DB_NAME = "timetrack_perf_test"
PORT = 8200
HEADERS = {"X-Requested-With": "timetrack"}
PASSWORD = "perf-check-password-123"  # noqa: S105 - disposable database only
FIRST_MONDAY = date(2025, 10, 20)


def build_dataset(url: str, employees: int, weeks: int, rng: random.Random) -> int:
    engine = make_engine(url)
    with Session(engine) as db:
        seed(db, password=PASSWORD, sample_entries=False)  # projects, tasks, codes, 4 users
        pw = hash_password(PASSWORD)
        manager_id = db.query(User).filter(User.email == "manager@example.test").one().id
        for n in range(employees):
            db.add(
                User(
                    email=f"perf{n:03d}@example.test",
                    display_name=f"Perf Employee {n}",
                    role=Role.EMPLOYEE,
                    manager_id=manager_id,
                    password_hash=pw,
                )
            )
        db.commit()
        users = [u.id for u in db.query(User).filter(User.role == Role.EMPLOYEE).all()]
        projects = db.query(Project).filter(Project.is_active.is_(True)).all()
        tasks = {
            p.id: [t.id for t in db.query(ProjectTask).filter_by(project_id=p.id)] for p in projects
        }
        codes = db.query(EarningCode).filter(EarningCode.is_active.is_(True)).all()

        week_rows: list[dict[str, object]] = []
        entry_rows: list[dict[str, object]] = []
        for employee in users:
            for w in range(weeks):
                start = FIRST_MONDAY - timedelta(weeks=w + 1)
                week_id = uuid.uuid4()
                week_rows.append(
                    {
                        "id": week_id,
                        "employee_id": employee,
                        "week_start_date": start,
                        "week_end_date": start + timedelta(days=6),
                        "status": WeekStatus.DRAFT if w == 0 else WeekStatus.APPROVED,
                    }
                )
                for d in range(rng.choice([5, 5, 5, 6, 7])):
                    project = rng.choice(projects)
                    task_ids = tasks[project.id]
                    entry_rows.append(
                        {
                            "id": uuid.uuid4(),
                            "timesheet_week_id": week_id,
                            "employee_id": employee,
                            "work_date": start + timedelta(days=d),
                            "hours": Decimal(rng.choice(["4.00", "7.50", "8.00", "8.00", "2.25"])),
                            "earning_code_id": rng.choice(codes).id,
                            "project_id": project.id,
                            "task_id": rng.choice(task_ids) if task_ids else None,
                            "description": f"Synthetic work item {rng.randrange(10_000)}",
                        }
                    )
        db.execute(insert(TimesheetWeek), week_rows)
        for i in range(0, len(entry_rows), 5000):
            db.execute(insert(TimeEntry), entry_rows[i : i + 5000])
        db.commit()
        db.execute(text("ANALYZE"))
        db.commit()
    engine.dispose()
    return len(entry_rows)


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round(pct / 100 * len(ordered)) - 1))
    return ordered[index]


class Timer:
    def __init__(self) -> None:
        self.rows: list[tuple[str, int, float, float, float, float]] = []

    def run(
        self, label: str, count: int, call: Callable[[int], httpx.Response], ok: set[int]
    ) -> None:
        samples: list[float] = []
        for i in range(count):
            started = time.perf_counter()
            response = call(i)
            samples.append((time.perf_counter() - started) * 1000)
            if response.status_code not in ok:
                raise SystemExit(
                    f"{label}: unexpected {response.status_code}: {response.text[:200]}"
                )
        self.rows.append(
            (
                label,
                count,
                statistics.median(samples),
                percentile(samples, 95),
                percentile(samples, 99),
                max(samples),
            )
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--budget-ms", type=float, default=500.0)
    parser.add_argument("--employees", type=int, default=50)
    parser.add_argument("--weeks", type=int, default=52)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    base = make_url(get_settings().database_url).set(database=DB_NAME)
    recreate_database(base)
    upgrade_database(base)
    url = base.render_as_string(hide_password=False)
    started = time.perf_counter()
    entries = build_dataset(url, args.employees, args.weeks, random.Random(args.seed))
    print(
        f"dataset: {args.employees} employees x {args.weeks} weeks = {entries} entries "
        f"(built in {time.perf_counter() - started:.1f}s)"
    )

    env = {
        **os.environ,
        "DATABASE_URL": url,
        "APP_ENV": "test",
        "LOG_LEVEL": "WARNING",
        "LOGIN_MAX_ATTEMPTS": "1000",
        "CORS_ORIGINS": f"http://localhost:{PORT}",
    }
    server = subprocess.Popen(  # noqa: S603
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
        ],
        cwd=Path(__file__).resolve().parent.parent,
        env=env,
    )
    try:
        client = httpx.Client(
            base_url=f"http://127.0.0.1:{PORT}/api/v1", headers=HEADERS, timeout=30
        )
        for _ in range(100):
            try:
                if client.get("/health/ready").status_code == 200:
                    break
            except httpx.TransportError:
                time.sleep(0.2)
        login = client.post(
            "/auth/login", json={"email": "perf000@example.test", "password": PASSWORD}
        )
        login.raise_for_status()
        project = client.get("/projects").json()["items"]
        project_with_tasks = next(p for p in project if p["code"] == "PRJ-001")
        task_id = client.get(f"/projects/{project_with_tasks['id']}/tasks").json()["items"][0]["id"]
        code_id = client.get("/earning-codes").json()["items"][0]["id"]

        def body(day: date, hours: str = "8.00") -> dict[str, object]:
            return {
                "work_date": day.isoformat(),
                "hours": hours,
                "earning_code_id": code_id,
                "project_id": project_with_tasks["id"],
                "task_id": task_id,
                "description": "Performance check entry",
            }

        rng = random.Random(1)
        history = [FIRST_MONDAY - timedelta(weeks=w + 1) for w in range(args.weeks)]
        future = [FIRST_MONDAY + timedelta(weeks=w + 1) for w in range(400)]
        timer = Timer()
        created: list[str] = []

        timer.run("GET /meta", 100, lambda _: client.get("/meta"), {200})
        timer.run("GET /projects", 100, lambda _: client.get("/projects"), {200})
        timer.run(
            "GET /timesheets/weeks/{date}  (dashboard)",
            300,
            lambda _: client.get(f"/timesheets/weeks/{rng.choice(history)}"),
            {200},
        )

        def create(i: int) -> httpx.Response:
            response = client.post("/time-entries", json=body(future[i % len(future)]))
            if response.status_code == 201:
                created.append(response.json()["id"])
            return response

        timer.run("POST /time-entries  (save entry)", 150, create, {201})
        timer.run(
            "PATCH /time-entries/{id}",
            150,
            lambda i: client.patch(f"/time-entries/{created[i]}", json={"hours": "6.50"}),
            {200},
        )
        batch_weeks = future[150:250]
        timer.run(
            "POST /time-entries/batch  (5 days)",
            100,
            lambda i: client.post(
                "/time-entries/batch",
                json={"entries": [body(batch_weeks[i] + timedelta(days=d)) for d in range(5)]},
            ),
            {201},
        )
        timer.run(
            "DELETE /time-entries/{id}",
            150,
            lambda i: client.delete(f"/time-entries/{created[i]}"),
            {204},
        )

        # Submission: each timed request moves a different draft week (with one entry) to SUBMITTED.
        submit_weeks = future[250:350]
        for monday in submit_weeks:
            client.post("/time-entries", json=body(monday)).raise_for_status()
        submitted_ids: list[str] = []

        def submit(i: int) -> httpx.Response:
            response = client.post(f"/timesheets/weeks/{submit_weeks[i]}/submit", json={})
            if response.status_code == 200:
                submitted_ids.append(response.json()["id"])
            return response

        timer.run("POST /timesheets/weeks/{date}/submit", 100, submit, {200})

        # Manager review: a separate session for the assigned manager.
        boss = httpx.Client(base_url=client.base_url, headers=HEADERS, timeout=30)
        boss.post(
            "/auth/login", json={"email": "manager@example.test", "password": PASSWORD}
        ).raise_for_status()
        pages = args.weeks * args.employees // 20  # roughly how many pages of 20 exist
        timer.run(
            "GET /approvals (waiting, 100 submitted)",
            100,
            lambda _: boss.get("/approvals", params={"status": "SUBMITTED", "page_size": 20}),
            {200},
        )
        timer.run(
            "GET /approvals (approved, deep paging)",
            100,
            lambda i: boss.get(
                "/approvals",
                params={"status": "APPROVED", "page": 1 + (i * 7) % max(pages, 1), "page_size": 20},
            ),
            {200},
        )
        timer.run(
            "GET /approvals/{id} (review page)",
            100,
            lambda i: boss.get(f"/approvals/{submitted_ids[i]}"),
            {200},
        )
        timer.run(
            "POST /approvals/{id}/approve",
            100,
            lambda i: boss.post(f"/approvals/{submitted_ids[i]}/approve", json={"comment": "ok"}),
            {200},
        )

        # Administration and reports (Phase 7): an administrator's session.
        admin = httpx.Client(base_url=client.base_url, headers=HEADERS, timeout=30)
        admin.post(
            "/auth/login", json={"email": "admin@example.test", "password": PASSWORD}
        ).raise_for_status()
        timer.run("GET /admin/users (page of 20)", 100, lambda _: admin.get("/admin/users"), {200})
        timer.run(
            "GET /admin/users?search=",
            100,
            lambda i: admin.get("/admin/users", params={"search": f"perf0{i % 5}"}),
            {200},
        )
        timer.run("GET /admin/projects", 100, lambda _: admin.get("/admin/projects"), {200})
        timer.run("GET /admin/policy", 100, lambda _: admin.get("/admin/policy"), {200})
        timer.run(
            "PUT /admin/policy",
            50,
            lambda i: admin.put(
                "/admin/policy",
                json={
                    "max_hours_per_entry": "12.00",
                    "max_hours_per_day": f"{14 + i % 3}.00",
                    "max_hours_per_week": "60.00",
                    "description_max_length": 200,
                },
            ),
            {200},
        )
        created_users: list[str] = []

        def create_user(i: int) -> httpx.Response:
            response = admin.post(
                "/admin/users",
                json={
                    "email": f"newperf{i:03d}@example.test",
                    "display_name": f"New Perf {i}",
                    "role": "EMPLOYEE",
                    "manager_id": None,
                },
            )
            if response.status_code == 201:
                created_users.append(response.json()["user"]["id"])
            return response

        # Includes hashing the generated temporary password (Argon2id is deliberately slow).
        timer.run("POST /admin/users (incl. Argon2id)", 30, create_user, {201})
        timer.run(
            "PATCH /admin/users/{id}",
            30,
            lambda i: admin.patch(
                f"/admin/users/{created_users[i]}", json={"display_name": f"Renamed {i}"}
            ),
            {200},
        )
        timer.run("GET /admin/audit (page of 20)", 100, lambda _: admin.get("/admin/audit"), {200})

        window = {
            "date_from": (FIRST_MONDAY - timedelta(weeks=args.weeks)).isoformat(),
            "date_to": FIRST_MONDAY.isoformat(),
        }

        def report_by(group: str) -> Callable[[int], httpx.Response]:
            return lambda _: admin.get("/reports/hours", params={**window, "group_by": group})

        for group in ("employee", "project", "earning_code", "week"):
            timer.run(
                f"GET /reports/hours (admin, by {group}, {args.weeks} wk)",
                30,
                report_by(group),
                {200},
            )
        timer.run(
            "GET /reports/hours (manager, by employee)",
            30,
            lambda _: boss.get("/reports/hours", params={**window, "group_by": "employee"}),
            {200},
        )
        timer.run(
            "GET /reports/hours.csv (admin, by employee)",
            30,
            lambda _: admin.get("/reports/hours.csv", params={**window, "group_by": "employee"}),
            {200},
        )

        # Light parallel load: 8 concurrent clients reading different weeks.
        def worker(_: int) -> list[float]:
            local = httpx.Client(
                base_url=client.base_url, headers=HEADERS, cookies=client.cookies, timeout=30
            )
            out = []
            for _ in range(60):
                t0 = time.perf_counter()
                r = local.get(f"/timesheets/weeks/{random.choice(history)}")
                out.append((time.perf_counter() - t0) * 1000)
                assert r.status_code == 200
            return out

        with ThreadPoolExecutor(8) as pool:
            parallel = [s for part in pool.map(worker, range(8)) for s in part]
        timer.rows.append(
            (
                "GET week, 8 concurrent clients",
                len(parallel),
                statistics.median(parallel),
                percentile(parallel, 95),
                percentile(parallel, 99),
                max(parallel),
            )
        )
    finally:
        server.terminate()
        server.wait(timeout=10)

    print(
        f"\nmachine: {platform.platform()}, python {platform.python_version()}, "
        f"{os.cpu_count()} CPUs, 1 uvicorn worker, local PostgreSQL"
    )
    print(
        f"{'endpoint':<56}{'n':>5}{'p50':>9}{'p95':>9}{'p99':>9}{'max':>9}"
        f"   vs {args.budget_ms:.0f} ms"
    )
    failed = False
    for label, n, p50, p95, p99, worst in timer.rows:
        verdict = "ok" if p95 <= args.budget_ms else "OVER BUDGET"
        failed |= p95 > args.budget_ms
        print(f"{label:<56}{n:>5}{p50:>9.1f}{p95:>9.1f}{p99:>9.1f}{worst:>9.1f}   {verdict}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
