"""Hours reports: scope, accuracy, validation, CSV export."""

from __future__ import annotations

import csv
import io
import logging
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Classification, Role, User, WeekStatus
from app.tests.conftest import make_settings
from app.tests.factories import login, make_earning, make_entry, make_project, make_user, make_week
from app.tests.support import API

R = f"{API}/reports"
MON = date(2026, 10, 19)
RANGE = {"date_from": "2026-10-01", "date_to": "2026-12-31"}


@dataclass
class Staff:
    m: TestClient
    m2: TestClient
    admin: TestClient
    employee: TestClient
    e1: User
    e2: User
    e3: User
    p1_id: str
    p2_id: str
    adm_user: User


@pytest.fixture
def staff(db: Session, login_as: Any) -> Staff:
    reg = make_earning(db, "REG", Classification.CAPPED)
    ovt = make_earning(db, "OVT", Classification.NON_CAPPED)
    p1 = make_project(db, "P1", name="Platform")
    p2 = make_project(db, "P2", name="Portal")
    m = make_user(db, "m@example.test", Role.MANAGER)
    m2 = make_user(db, "m2@example.test", Role.MANAGER)
    adm = make_user(db, "adm@example.test", Role.ADMIN)
    e1 = make_user(db, "e1@example.test")
    e2 = make_user(db, "e2@example.test")
    e3 = make_user(db, "e3@example.test")
    e1.manager_id = e2.manager_id = m.id
    e3.manager_id = m2.id
    db.commit()

    def week(user: User, start: date, status: WeekStatus) -> Any:
        return make_week(db, user, start, status)

    w1 = week(e1, MON, WeekStatus.APPROVED)
    make_entry(db, w1, p1, reg, MON, "8.00", description="Mon")
    make_entry(db, w1, p1, ovt, MON + timedelta(days=1), "6.00", description="Tue")
    w2 = week(e2, MON, WeekStatus.APPROVED)
    make_entry(db, w2, p2, reg, MON, "4.00")
    w3 = week(e3, MON, WeekStatus.APPROVED)
    make_entry(db, w3, p1, reg, MON, "5.00")
    w4 = week(e1, MON + timedelta(days=7), WeekStatus.SUBMITTED)
    make_entry(db, w4, p2, reg, MON + timedelta(days=7), "3.00")
    w5 = week(e1, MON + timedelta(days=14), WeekStatus.DRAFT)
    make_entry(db, w5, p1, reg, MON + timedelta(days=14), "9.00")
    w6 = week(e2, MON - timedelta(days=7), WeekStatus.REJECTED)
    make_entry(db, w6, p1, reg, MON - timedelta(days=7), "2.00")
    wa = week(adm, MON, WeekStatus.APPROVED)
    make_entry(db, wa, p1, reg, MON, "7.00")  # the admin's own hours
    return Staff(
        m=login_as("m@example.test"),
        m2=login_as("m2@example.test"),
        admin=login_as("adm@example.test"),
        employee=login_as("e1@example.test"),
        e1=e1,
        e2=e2,
        e3=e3,
        p1_id=str(p1.id),
        p2_id=str(p2.id),
        adm_user=adm,
    )


def report(c: TestClient, **params: Any) -> Any:
    return c.get(f"{R}/hours", params={**RANGE, **params})


def by_label(response: Any) -> dict[str, dict[str, Any]]:
    return {i["label"]: i for i in response.json()["items"]}


# ----------------------------------------------------------------------------- access


def test_employees_and_visitors_have_no_reports(staff: Staff, client: TestClient) -> None:
    assert report(staff.employee).status_code == 403
    assert staff.employee.get(f"{R}/hours.csv", params=RANGE).status_code == 403
    assert client.get(f"{R}/hours", params=RANGE).status_code == 401


def test_a_manager_reports_only_on_their_own_people(staff: Staff) -> None:
    body = report(staff.m).json()
    assert {i["detail"] for i in body["items"]} == {"e1@example.test", "e2@example.test"}
    assert report(staff.m2).json()["items"][0]["detail"] == "e3@example.test"


def test_an_administrator_sees_everyone_except_themselves(staff: Staff) -> None:
    emails = {i["detail"] for i in report(staff.admin).json()["items"]}
    assert emails == {"e1@example.test", "e2@example.test", "e3@example.test"}  # not adm@
    assert report(staff.admin).json()["totals"]["total_hours"] == "23.00"


# --------------------------------------------------------------------------- accuracy


def test_totals_split_capped_and_non_capped_exactly(staff: Staff) -> None:
    response = report(staff.m)
    rows = by_label(response)
    e1 = rows[staff.e1.display_name]
    assert (e1["total_hours"], e1["capped_hours"], e1["non_capped_hours"], e1["entry_count"]) == (
        "14.00",
        "8.00",
        "6.00",
        2,
    )
    assert rows[staff.e2.display_name]["total_hours"] == "4.00"
    totals = response.json()["totals"]
    assert totals == {
        "total_hours": "18.00",
        "capped_hours": "12.00",
        "non_capped_hours": "6.00",
        "entry_count": 3,
        "employee_count": 2,
    }


def test_decimal_sums_are_exact(staff: Staff, db: Session) -> None:
    reg = make_earning(db, "EXTRA", Classification.CAPPED)
    p = make_project(db, "PX")
    w = make_week(db, staff.e2, MON + timedelta(days=21), WeekStatus.APPROVED)
    make_entry(db, w, p, reg, MON + timedelta(days=21), "0.10")
    make_entry(db, w, p, reg, MON + timedelta(days=22), "0.20")
    body = report(staff.m, group_by="project", project_id=str(p.id)).json()
    assert body["items"][0]["total_hours"] == "0.30"


def test_only_the_requested_statuses_count_and_drafts_never_do(staff: Staff) -> None:
    assert report(staff.m).json()["totals"]["total_hours"] == "18.00"  # approved only (default)
    both = report(staff.m, status=["APPROVED", "SUBMITTED"]).json()
    assert both["totals"]["total_hours"] == "21.00"
    assert both["statuses"] == ["APPROVED", "SUBMITTED"]
    rejected = report(staff.m, status="REJECTED", date_from="2026-10-01").json()
    assert rejected["totals"]["total_hours"] == "2.00"
    draft = report(staff.m, status="DRAFT")
    assert draft.status_code == 422 and "status" in draft.json()["error"]["field_errors"]
    assert report(staff.m, status=["APPROVED", "DRAFT"]).status_code == 422


@pytest.mark.parametrize(
    ("group_by", "expected"),
    [
        ("employee", {"E1": "14.00", "E2": "4.00"}),
        ("project", {"P1": "14.00", "P2": "4.00"}),
        ("earning_code", {"OVT": "6.00", "REG": "12.00"}),
        ("week", {"2026-10-19": "18.00"}),
    ],
)
def test_every_grouping(staff: Staff, group_by: str, expected: dict[str, str]) -> None:
    body = report(staff.m, group_by=group_by).json()
    got = {
        (i["label"] if group_by != "employee" else i["label"].upper().replace(" ", "")[:2]): i[
            "total_hours"
        ]
        for i in body["items"]
    }
    if group_by == "employee":
        got = {i["detail"].split("@")[0].upper(): i["total_hours"] for i in body["items"]}
    assert got == expected
    assert body["group_by"] == group_by
    assert sum(float(i["total_hours"]) for i in body["items"]) == float(
        body["totals"]["total_hours"]
    )


def test_the_date_range_is_inclusive_on_both_ends(staff: Staff) -> None:
    only_tuesday = report(staff.m, date_from="2026-10-20", date_to="2026-10-20").json()
    assert only_tuesday["totals"]["total_hours"] == "6.00"
    monday = report(staff.m, date_from="2026-10-19", date_to="2026-10-19").json()
    assert monday["totals"]["total_hours"] == "12.00"
    assert report(staff.m, date_from="2026-10-21", date_to="2026-10-25").json()["items"] == []


def test_employee_and_project_filters_cannot_reach_outside_scope(staff: Staff) -> None:
    mine = report(staff.m, employee_id=str(staff.e1.id)).json()
    assert [i["detail"] for i in mine["items"]] == ["e1@example.test"]
    foreign = report(staff.m, employee_id=str(staff.e3.id)).json()  # someone else's report
    assert foreign["items"] == [] and foreign["totals"]["total_hours"] == "0.00"
    assert report(staff.m, employee_id=str(uuid.uuid4())).json()["items"] == []
    p2 = report(staff.m, group_by="project", project_id=staff.p2_id).json()
    assert [i["label"] for i in p2["items"]] == ["P2"]


def test_paging_covers_every_group_and_leaves_totals_alone(staff: Staff) -> None:
    first = report(staff.admin, page_size=2, page=1).json()
    second = report(staff.admin, page_size=2, page=2).json()
    assert (first["total"], len(first["items"]), len(second["items"])) == (3, 2, 1)
    names = [i["label"] for i in first["items"] + second["items"]]
    assert names == sorted(names) and len(set(names)) == 3
    assert first["totals"] == second["totals"]  # totals always describe the whole report
    assert report(staff.admin, page_size=2, page=3).json()["items"] == []
    assert report(staff.admin, page_size=101).status_code == 422


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"date_from": "2026-12-31", "date_to": "2026-10-01"}, "date_to"),
        ({"date_from": "2025-01-01", "date_to": "2026-12-31"}, "date_to"),  # > 366 days
        ({"date_from": "not-a-date"}, "date_from"),
        ({"group_by": "colour"}, "group_by"),
    ],
)
def test_bad_parameters_are_rejected(staff: Staff, params: dict[str, str], field: str) -> None:
    response = report(staff.m, **params)
    assert response.status_code == 422
    assert field in response.json()["error"]["field_errors"]


def test_dates_are_required(staff: Staff) -> None:
    assert staff.m.get(f"{R}/hours").status_code == 422


# ------------------------------------------------------------------------------- CSV


def parse(response: Any) -> list[list[str]]:
    return list(csv.reader(io.StringIO(response.text)))


def test_csv_matches_the_json_report(staff: Staff) -> None:
    response = staff.m.get(f"{R}/hours.csv", params=RANGE)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="hours-2026-10-01-2026-12-31.csv"'
    )
    assert response.headers["cache-control"] == "no-store"
    rows = parse(response)
    assert rows[0] == [
        "Group",
        "Detail",
        "Total hours",
        "Capped hours",
        "Non-capped hours",
        "Entries",
        "People",
    ]
    assert [r[1] for r in rows[1:-1]] == ["e1@example.test", "e2@example.test"]
    assert rows[1][2:] == ["14.00", "8.00", "6.00", "2", "1"]
    assert rows[-1] == ["Total", "", "18.00", "12.00", "6.00", "3", "2"]


def test_csv_neutralises_spreadsheet_formulas(staff: Staff, db: Session) -> None:
    evil_name = '=HYPERLINK("http://evil.example","click")'
    staff.e1.display_name = "+SUM(A1)"
    project = make_project(db, "EVIL", name=evil_name)
    w = make_week(db, staff.e1, MON + timedelta(days=28), WeekStatus.APPROVED)
    make_entry(
        db,
        w,
        project,
        make_earning(db, "Z", Classification.CAPPED),
        MON + timedelta(days=28),
        "1.00",
    )
    db.commit()
    by_employee = parse(staff.m.get(f"{R}/hours.csv", params={**RANGE, "group_by": "employee"}))
    by_project = parse(staff.m.get(f"{R}/hours.csv", params={**RANGE, "group_by": "project"}))
    assert any(r[0] == "'+SUM(A1)" for r in by_employee)
    assert any(r[1] == "'" + evil_name for r in by_project)
    for rows in (by_employee, by_project):
        for r in rows:
            assert not r[0].startswith(("=", "+", "-", "@")) and not r[1].startswith(
                ("=", "+", "-", "@")
            )


def test_exports_are_logged_without_their_contents(
    staff: Staff, make_client: Any, test_url: Any
) -> None:
    records: list[logging.LogRecord] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    client = make_client(make_settings(test_url, log_level="INFO"))
    handler = Capture()
    logging.getLogger("timetrack").addHandler(handler)
    try:
        login(client, "m@example.test")
        client.get(f"{R}/hours.csv", params=RANGE)
    finally:
        logging.getLogger("timetrack").removeHandler(handler)
    [event] = [r for r in records if r.getMessage() == "report_exported"]
    assert event.rows == 2  # type: ignore[attr-defined]
    assert event.group_by == "employee"  # type: ignore[attr-defined]
    everything = " ".join(f"{r.getMessage()} {r.__dict__}" for r in records)
    assert "e1@example.test" not in everything and "14.00" not in everything
