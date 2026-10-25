#!/usr/bin/env bash
# Prove that a backup can actually be restored: dump the database, restore it into a throwaway
# database, and compare it with the source. Never writes to the source database.
#
# Usage: scripts/backup-restore-drill.sh [CONTAINER]    (default container: timetrack-db)
# Reads POSTGRES_USER / POSTGRES_DB from .env. Needs only Docker; pg_dump/pg_restore run in the
# container. For a non-Docker database, run the same pg_dump/pg_restore steps by hand
# (docs/operations.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${1:-timetrack-db}"
set -a; . "$ROOT/.env"; set +a
PGUSER="${POSTGRES_USER:-timetrack}"
SRC="${POSTGRES_DB:-timetrack}"
DRILL="${SRC}_restore_drill"      # the suffix is what makes dropping it below safe
DUMP="$(mktemp -t timetrack-drill.XXXXXX)"
trap 'rm -f "$DUMP"; psql_admin "DROP DATABASE IF EXISTS \"$DRILL\" WITH (FORCE)" >/dev/null 2>&1 || true' EXIT

psql_admin() { docker exec -i "$CONTAINER" psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 -qAt -c "$1"; }
psql_db()    { docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$1" -v ON_ERROR_STOP=1 -qAt -c "$2"; }

# One "table=count" line per table, sorted: identical output means identical row counts.
counts() {
  local db="$1" tables
  tables=$(psql_db "$db" "select tablename from pg_tables where schemaname='public' order by 1")
  for t in $tables; do echo "$t=$(psql_db "$db" "select count(*) from \"$t\"")"; done
}

echo "1/6 dump '$SRC' (custom format)"
docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$SRC" -Fc --no-owner > "$DUMP"
echo "    $(wc -c < "$DUMP" | tr -d ' ') bytes"

echo "2/6 restore into throwaway '$DRILL'"
psql_admin "DROP DATABASE IF EXISTS \"$DRILL\" WITH (FORCE)" >/dev/null
psql_admin "CREATE DATABASE \"$DRILL\"" >/dev/null
docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$DRILL" --no-owner --exit-on-error < "$DUMP"

echo "3/6 compare row counts of every table"
A="$(counts "$SRC")"; B="$(counts "$DRILL")"
if [ "$A" != "$B" ]; then echo "MISMATCH"; diff <(echo "$A") <(echo "$B") || true; exit 1; fi
echo "$A" | sed 's/^/    /'

echo "4/6 migration version and schema objects"
VA="$(psql_db "$SRC" 'select version_num from alembic_version')"
VB="$(psql_db "$DRILL" 'select version_num from alembic_version')"
[ "$VA" = "$VB" ] || { echo "alembic version differs: $VA vs $VB"; exit 1; }
echo "    alembic version $VB"
TA="$(psql_db "$SRC" "select count(*) from pg_trigger where not tgisinternal")"
TB="$(psql_db "$DRILL" "select count(*) from pg_trigger where not tgisinternal")"
[ "$TA" = "$TB" ] && [ "$TB" -ge 3 ] || { echo "triggers differ or missing: $TA vs $TB"; exit 1; }
echo "    $TB triggers present (append-only audit protection)"

echo "5/6 append-only protection still works in the restored copy"
for table in approval_events time_entry_events config_audit_events; do
  if [ "$(psql_db "$DRILL" "select count(*) from $table")" -gt 0 ]; then
    if psql_db "$DRILL" "update $table set created_at = created_at" >/dev/null 2>&1; then
      echo "    $table accepted an UPDATE: protection lost"; exit 1
    fi
    echo "    $table: UPDATE refused"
  else
    echo "    $table: empty (trigger presence checked above)"
  fi
done

echo "6/6 users, sessions and encrypted passwords came across"
psql_db "$DRILL" "select 'users with a password hash: ' || count(*) from users where password_hash is not null" | sed 's/^/    /'

echo "OK: backup restored and verified; throwaway database dropped."
