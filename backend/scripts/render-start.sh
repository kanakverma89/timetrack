#!/bin/sh
# Start command for the free Render web service (see render.yaml and docs/deployment-free-tier.md).
# Free instances have no pre-deploy command, so migrate here (idempotent), then serve.
# A script, not an inline command, because Render does not run dockerCommand through a shell.
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}" \
  --proxy-headers --forwarded-allow-ips "*" --no-server-header
