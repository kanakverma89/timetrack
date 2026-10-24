"""Put a week into a given lifecycle state in the disposable E2E database (test set-up only).

    python scripts/e2e_state.py --email employee@example.test --week 2027-01-04 \
        --status REJECTED --comment "Please correct Tuesday."

Manager decisions have no API until Phase 6, so end-to-end tests use this to reach states such as
REJECTED. It refuses to run against any database whose name does not end in ``_test`` or ``_e2e``.
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import make_engine
from app.db_admin import assert_disposable
from app.models import ApprovalAction, ApprovalEvent, TimesheetWeek, User, WeekStatus

MANAGER_EMAIL = "manager@example.test"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--week", required=True, help="week start date, YYYY-MM-DD")
    parser.add_argument("--status", required=True, choices=[s.value for s in WeekStatus])
    parser.add_argument("--comment", default=None)
    args = parser.parse_args()

    url = make_url(get_settings().database_url)
    assert_disposable(url.database)
    engine = make_engine(url.render_as_string(hide_password=False))
    with Session(engine) as db:
        employee = db.scalar(select(User).where(User.email == args.email))
        manager = db.scalar(select(User).where(User.email == MANAGER_EMAIL))
        week = (
            db.scalar(
                select(TimesheetWeek).where(
                    TimesheetWeek.employee_id == employee.id,
                    TimesheetWeek.week_start_date == date.fromisoformat(args.week),
                )
            )
            if employee
            else None
        )
        if employee is None or manager is None or week is None:
            print("Unknown employee, manager or week.", file=sys.stderr)
            return 2
        status = WeekStatus(args.status)
        week.status = status
        decided = status in (WeekStatus.REJECTED, WeekStatus.APPROVED)
        week.reviewed_by = manager.id if decided else None
        week.reviewed_at = datetime.now(UTC) if decided else None
        week.review_comment = args.comment if decided else None
        if status is WeekStatus.REJECTED:
            db.add(
                ApprovalEvent(
                    timesheet_week_id=week.id,
                    actor_id=manager.id,
                    action=ApprovalAction.REJECTED,
                    comment=args.comment,
                )
            )
        db.commit()
    print(f"{args.email} {args.week} -> {args.status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
