"""Create a fresh disposable database, migrate it and optionally seed it.

Usage: python scripts/prepare_db.py <name> [--seed]

Only databases whose name ends in ``_test`` or ``_e2e`` can be (re)created, so this can never
drop a development database.
"""

from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import make_engine
from app.db_admin import recreate_database, upgrade_database
from app.seeding import seed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name")
    parser.add_argument(
        "--seed", action="store_true", help="seed synthetic data with sample entries"
    )
    args = parser.parse_args()

    url = make_url(get_settings().database_url).set(database=args.name)
    recreate_database(url)
    upgrade_database(url)
    if args.seed:
        password = os.environ.get("SEED_PASSWORD", "")
        if not password:
            print("SEED_PASSWORD is not set.", file=sys.stderr)
            return 2
        engine = make_engine(url.render_as_string(hide_password=False))
        with Session(engine) as db:
            seed(db, password=password, sample_entries=True)
        engine.dispose()
    print(f"Database {args.name} ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
