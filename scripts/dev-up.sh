#!/usr/bin/env bash
# Bring the local dev environment up: PostgreSQL (Docker), migrations, API (8000), web (5173).
# Usage: scripts/dev-up.sh [--seed]     --seed re-runs the idempotent synthetic seed first
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.dev"
API_PORT=8000
WEB_PORT=5173
mkdir -p "$STATE"

[ -f "$ROOT/.env" ] || { echo "Missing .env — copy .env.example to .env and fill in the placeholders." >&2; exit 1; }
[ -x "$ROOT/backend/.venv/bin/uvicorn" ] || { echo "Backend deps missing: cd backend && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'" >&2; exit 1; }
[ -d "$ROOT/frontend/node_modules" ] || { echo "Frontend deps missing: cd frontend && npm ci" >&2; exit 1; }

listening() { lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

wait_for() { # url label
  for _ in $(seq 1 40); do
    curl -fsS -o /dev/null "$1" 2>/dev/null && { echo "  ✓ $2"; return 0; }
    sleep 0.5
  done
  echo "  ✗ $2 did not become ready — see logs in $STATE" >&2
  return 1
}

echo "Database"
(cd "$ROOT" && docker compose up -d --wait db </dev/null >/dev/null 2>&1) && echo "  ✓ timetrack-db healthy"

set -a; . "$ROOT/.env"; set +a

echo "Migrations"
(cd "$ROOT/backend" && .venv/bin/alembic upgrade head >/dev/null 2>&1) && echo "  ✓ schema at head"

if [ "${1:-}" = "--seed" ]; then
  echo "Seed"
  (cd "$ROOT/backend" && .venv/bin/python scripts/seed.py --sample-entries) | sed 's/^/  /'
fi

echo "API (http://localhost:$API_PORT)"
if listening "$API_PORT"; then
  echo "  • port $API_PORT already in use — assuming the API is running"
else
  (
    cd "$ROOT/backend"
    nohup .venv/bin/uvicorn app.main:app --reload --port "$API_PORT" \
      </dev/null >"$STATE/api.log" 2>&1 &
    echo $! >"$STATE/api.pid"
  )
fi
wait_for "http://localhost:$API_PORT/api/v1/health/ready" "API ready"

echo "Web (http://localhost:$WEB_PORT)"
if listening "$WEB_PORT"; then
  echo "  • port $WEB_PORT already in use — assuming the web app is running"
else
  (
    cd "$ROOT/frontend"
    nohup npm run dev </dev/null >"$STATE/web.log" 2>&1 &
    echo $! >"$STATE/web.pid"
  )
fi
wait_for "http://localhost:$WEB_PORT/" "web ready"

cat <<MSG

Environment is up.
  App:  http://localhost:$WEB_PORT/?week=2026-10-19
  API:  http://localhost:$API_PORT/api/v1/docs
  Sign in as employee@example.test with SEED_PASSWORD from .env
  Logs: $STATE/api.log, $STATE/web.log
Stop with scripts/dev-down.sh
MSG
