# Operations guide

How to run TimeTrack outside a laptop: deploy, configure, back up, restore, retain and maintain.
Everything below that says "verified" was run (see the Phase 7 section of the implementation report);
anything else is guidance that has not been exercised in a real production environment.

> Looking for a free demo instead of a real deployment? See `docs/deployment-free-tier.md`.

## Shape of a deployment

```
browser ──https──▶ TLS terminator ──http──▶ web (nginx :8080) ──▶ api (uvicorn :8000) ──▶ PostgreSQL 16
                   (yours)                   static app + /api       one process              private
```

`compose.prod.yaml` builds and runs `db`, a one-shot `migrate`, `api` and `web`. Only `web` publishes a
port (bound to `127.0.0.1`; change that deliberately). **TLS is not provided by this repository**:
terminate it in a load balancer or edge proxy and have it forward to `web`, setting
`X-Forwarded-Proto: https`. The session cookie is `Secure` in production, so the app will not sign in
over plain HTTP from anywhere except `localhost`.

Verified: `docker compose -f compose.prod.yaml up -d --build --wait` builds all images, runs the
migrations, and all services become healthy; the API runs as UID 10001 on a read-only filesystem with
no Linux capabilities; the first administrator was created with the CLI and signed in through nginx.

## Configuration

Environment variables (see `.env.example`). The API **refuses to start** in production if the secret or
database password is a placeholder, `SESSION_SECRET` is shorter than 32 characters, or `CORS_ORIGINS` is
not an exact list of `https://` origins.

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_ENV` | yes | `production` (set by `compose.prod.yaml`) |
| `DATABASE_URL` | yes | `postgresql+psycopg://user:pass@host:5432/db` |
| `SESSION_SECRET` | yes | ≥ 32 random chars. Rotating it signs everyone out |
| `CORS_ORIGINS` | yes | comma-separated public origin(s), e.g. `https://time.example.com` |
| `POSTGRES_PASSWORD` | compose | the database password |
| `BUSINESS_TIMEZONE`, `WEEK_START_DAY` | no | define which day a week starts and what "today" is. **Do not change after data exists** unless you accept that existing weeks keep their stored dates |
| `SESSION_TTL_HOURS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_SECONDS` | no | defaults 12 h, 5 attempts, 15 min |
| `MAX_HOURS_PER_ENTRY`, `MAX_HOURS_PER_DAY`, `MAX_HOURS_PER_WEEK`, `DESCRIPTION_MAX_LENGTH` | no | **defaults only**: an administrator can override them in the app (Admin → Policy); the stored values win, and *Restore defaults* returns to these |
| `ENABLE_DOCS` | no | off in production unless set to `true` |

Secrets belong in your platform's secret store, not in the repository or the image. `.env`, `.env.*` are
git-ignored.

### Behind a proxy: client addresses

Login throttling is keyed by client address and email. The API image starts uvicorn with
`--proxy-headers --forwarded-allow-ips '*'` so it reads `X-Forwarded-For`. That is safe **only because
the API port is never published**: only `web` can reach it, and `web` overwrites `X-Forwarded-For` with
the address it saw. If you expose the API directly or put another proxy in front of `web`, set
`--forwarded-allow-ips` to that proxy's address instead, otherwise clients can forge their address and
sidestep the throttle. (Verified: in the smoke test the API logged the caller's address, not nginx's.)

## First administrator

There is deliberately no default account. After the first deployment:

```bash
docker compose -f compose.prod.yaml --env-file .env.prod exec -e ADMIN_PASSWORD='…' api \
  python scripts/maintain.py create-admin you@example.com "Your Name"
```

The password must satisfy the normal policy (≥ 12 characters, not common, not containing the person's
name or email) and is marked *must change*: the administrator is forced to choose a new one at first
sign-in. Omit `ADMIN_PASSWORD` to be prompted instead. The value is never printed or logged.

Everything else (users, teams, managers, projects, tasks, earning codes, policy) is then done in the
application's Admin area.

## Upgrades and migrations

`migrate` runs `alembic upgrade head` before `api` starts. Migrations are forward-only in practice: the
`downgrade` functions exist and are tested, but a downgrade after data has changed can lose data. **Take a
backup before every upgrade.** `alembic check` in CI proves the models and migrations agree.

## Backup and restore

What to back up: the PostgreSQL database. There are no uploaded files. `SESSION_SECRET` is configuration,
not data, but keep a copy: without it existing sessions are invalid (which is harmless).

**Back up** (logical dump, consistent snapshot, works while the app runs):

```bash
docker compose -f compose.prod.yaml exec -T db pg_dump -U timetrack -d timetrack -Fc --no-owner > timetrack-$(date +%F).dump
```

Store dumps off the host, encrypted, with the retention you need (they contain personal data and
password hashes). Daily is a reasonable starting point; the loss window is the time since the last dump,
so choose it deliberately. Point-in-time recovery (WAL archiving) is the managed-database route if you
need a smaller window; it is not set up here.

**Restore**:

```bash
docker compose -f compose.prod.yaml exec -T db createdb -U timetrack timetrack_restored
docker compose -f compose.prod.yaml exec -T db pg_restore -U timetrack -d timetrack_restored --no-owner --exit-on-error < timetrack-2026-10-24.dump
```

Then point `DATABASE_URL` at the restored database (or restore into an empty `timetrack` on a fresh
volume), start the stack, and **revoke all sessions** so nobody is signed in on the strength of a
backup's old tokens:

```sql
UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL;
```

**Prove it works before you need it.** `scripts/backup-restore-drill.sh` dumps the database, restores it
into a throwaway database, and fails unless every table has the same row count, the schema version
matches, the append-only triggers came across, and an `UPDATE` on each non-empty audit table is still
refused. Run it on a schedule against a real copy of production data. Verified here against the
development database (16 tables, matching counts, 3 triggers, both non-empty audit tables refused an
update). The drill does not test restoring onto a different PostgreSQL major version, a corrupt dump, or
a truncated download; it does not replace checking that your off-host copies are intact.

## Retention

| Data | Kept | Why / how |
| --- | --- | --- |
| Weeks, time entries | until you decide otherwise | the business record; this repository ships no deletion |
| `approval_events`, `time_entry_events`, `config_audit_events` | indefinitely | append-only by a database trigger; they reference people by id, and hold no names, emails or entry descriptions. **Exception:** a rejection reason (`approval_events.comment`) is free text written by a manager and may mention a person; it is kept as the record of the decision, and anonymising a user does not rewrite it |
| Sessions | until 30 days after they end | `maintain.py purge` |
| Idempotency keys | 30 days | a retry after that is a new request; `purge` |
| Sent notification-outbox rows | 30 days | rows that are pending, processing or **failed** are never purged; `purge` |

```bash
python scripts/maintain.py purge --dry-run                 # count first
python scripts/maintain.py purge                           # then delete
python scripts/maintain.py purge --session-days 7 --outbox-days 14
```

Run it from a scheduler (a daily cron / scheduled task that executes it in the `api` container). It is
idempotent and takes row-level deletes only, so it is safe to run while the app is serving requests.

**Personal data and leavers.** Deactivating a user blocks sign-in and revokes sessions but keeps their
name, so history stays readable. When your own policy says a former person's identity must go:

```bash
python scripts/maintain.py anonymise-user former@example.com --confirm
```

This is irreversible. It replaces the name with "Former employee" and the email with
`user-<id>@anonymised.invalid`, removes the password, and keeps their hours, weeks and decisions so
totals and audit history still add up. It refuses active users and anyone who still has active reports.
Whether you *must* erase, and what else holds the person's data (backups, email, logs, other systems),
is a legal question this repository cannot answer: **old backups still contain the identity**.

## Health, logs and monitoring

- `GET /api/v1/health` (process up) and `/api/v1/health/ready` (database reachable) are public and carry
  no data. The containers use the latter.
- Logs are one JSON object per line on stdout with a request id (`X-Request-ID` is returned to the
  caller and appears in every error body, so a user's error report can be matched to a log line). No
  request bodies, passwords, session tokens or entry descriptions are logged.
- There are no metrics, tracing or alerting here. Minimum viable alerts: health check failing, 5xx rate,
  disk usage of the database volume, backup job age.

## Content-Security-Policy

nginx sends `default-src 'self'; script-src 'self'; style-src 'self'; …; frame-ancestors 'none'` for the
app and the API sends `default-src 'none'`. The app uses no inline scripts or `style` attributes, so the
policy needs no `unsafe-inline`. If you add analytics, fonts or other third-party resources, extend the
policy deliberately. WebKit/Safari logs `style-src-attr` console messages for native selects; they are
harmless (see `docs/security-review.md`, R-9).

## Known operational limits

- **One API process.** The login throttle and the notification worker are in-process. Scaling the API
  horizontally multiplies the effective throttle by the number of replicas; move it to the database or a
  cache before doing so (documented in `docs/security-review.md`).
- The notification adapter writes to the log; no email or chat integration is provided. Outbox rows left
  in `PROCESSING` by a crash are not recovered automatically.
- Nothing here has been load-tested beyond `scripts/perf_check.py` on one machine (`docs/performance.md`).
- No container image scanning, signing or SBOM is configured; the weekly dependency-audit workflow
  covers known vulnerabilities in Python and npm dependencies only, not the base images.
