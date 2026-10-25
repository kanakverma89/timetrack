"""Operator tasks.  Run from the backend directory with the production environment loaded.

python scripts/maintain.py purge [--dry-run] [--session-days N] [--idempotency-days N]
                                 [--outbox-days N]
python scripts/maintain.py anonymise-user EMAIL --confirm
python scripts/maintain.py create-admin EMAIL "Display Name"
    (the password is prompted for, or taken from ADMIN_PASSWORD when there is no terminal)
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.maintenance import MaintenanceError, anonymise_user, create_admin, purge
from app.models import User


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser(
        "purge", help="delete expired sessions, old idempotency keys, sent outbox rows"
    )
    p.add_argument(
        "--dry-run", action="store_true", help="count what would be deleted, delete nothing"
    )
    p.add_argument("--session-days", type=int, default=30)
    p.add_argument("--idempotency-days", type=int, default=30)
    p.add_argument("--outbox-days", type=int, default=30)

    a = sub.add_parser("anonymise-user", help="irreversibly remove a former user's name and email")
    a.add_argument("email")
    a.add_argument("--confirm", action="store_true", help="required: this cannot be undone")

    c = sub.add_parser("create-admin", help="create an administrator account")
    c.add_argument("email")
    c.add_argument("display_name")

    args = parser.parse_args(argv)
    try:
        with get_sessionmaker()() as db:
            if args.command == "purge":
                result = purge(
                    db,
                    session_days=args.session_days,
                    idempotency_days=args.idempotency_days,
                    outbox_days=args.outbox_days,
                    dry_run=args.dry_run,
                )
                verb = "Would delete" if args.dry_run else "Deleted"
                print(
                    f"{verb}: {result.sessions} sessions, {result.idempotency_keys} idempotency "
                    f"keys, {result.outbox} sent outbox rows."
                )
            elif args.command == "anonymise-user":
                if not args.confirm:
                    print(
                        "Refusing without --confirm: anonymisation is irreversible.",
                        file=sys.stderr,
                    )
                    return 2
                user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
                if user is None:
                    print("No such user.", file=sys.stderr)
                    return 1
                anonymise_user(db, user.id)
                print("User anonymised.")
            else:
                password = os.environ.get("ADMIN_PASSWORD") or (
                    getpass.getpass("Password: ") if sys.stdin.isatty() else ""
                )
                create_admin(
                    db, email=args.email, display_name=args.display_name, password=password
                )
                print("Administrator created; they must change the password at first sign-in.")
    except MaintenanceError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
