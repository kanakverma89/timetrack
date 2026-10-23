"""Seed synthetic development data.  Usage: python scripts/seed.py [--sample-entries]

Requires SEED_PASSWORD (>= 12 chars). Refuses to run when APP_ENV=production.
"""

from __future__ import annotations

import argparse
import os
import sys

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.seeding import seed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-entries", action="store_true", help="also create sample weeks")
    args = parser.parse_args()

    settings = get_settings()
    if settings.app_env == "production":
        print("Refusing to seed synthetic data in production.", file=sys.stderr)
        return 2
    password = os.environ.get("SEED_PASSWORD", "")
    if not password:
        print("SEED_PASSWORD is not set (see .env.example).", file=sys.stderr)
        return 2
    with get_sessionmaker()() as db:
        seed(db, password=password, sample_entries=args.sample_entries)
    print("Seed complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
