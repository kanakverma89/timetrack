#!/usr/bin/env bash
# Bring the local dev environment down: web, API, then PostgreSQL (data is kept).
# Usage: scripts/dev-down.sh [--keep-db]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$ROOT/.dev"

descendants() { # pid -> pid and all its descendants
  local pid="$1" child
  echo "$pid"
  for child in $(pgrep -P "$pid" 2>/dev/null); do descendants "$child"; done
}

stop_service() { # name pidfile expected-command-substring
  local name="$1" file="$STATE/$2.pid" expect="$3" pid cmd
  if [ ! -f "$file" ]; then echo "  • $name: not started by dev-up (no pid file)"; return; fi
  pid="$(cat "$file")"
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  if [ -z "$cmd" ]; then
    echo "  • $name: already stopped"
  elif [[ "$cmd" != *"$expect"* ]]; then
    echo "  ! $name: pid $pid is now a different process — not touching it" >&2
  else
    # shellcheck disable=SC2046
    kill $(descendants "$pid") 2>/dev/null
    echo "  ✓ $name stopped"
  fi
  rm -f "$file"
}

echo "Web";  stop_service web web "npm"
echo "API";  stop_service API api "uvicorn"

# Orphaned dev servers (e.g. the npm wrapper exited but vite lives on) still hold the ports.
for port in 5173 8000; do
  for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    if [[ "$cmd" == *"$ROOT"* ]]; then kill "$pid" 2>/dev/null && echo "  ✓ freed port $port (pid $pid)"; fi
  done
done

echo "Database"
if [ "${1:-}" = "--keep-db" ]; then
  echo "  • left running (--keep-db)"
else
  (cd "$ROOT" && docker compose stop db >/dev/null 2>&1) && echo "  ✓ timetrack-db stopped (data volume kept)"
fi
echo "Environment is down."
