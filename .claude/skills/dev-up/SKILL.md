---
name: dev-up
description: Bring the TimeTrack local dev environment up — PostgreSQL in Docker, migrations, the FastAPI API on :8000 and the Vite web app on :5173. Use when the user says dev-up, "start the app/environment", or wants to run TimeTrack locally.
disable-model-invocation: true
allowed-tools: Bash(scripts/dev-up.sh:*)
---

Start the local environment by running the project script from the repository root:

```bash
scripts/dev-up.sh $ARGUMENTS
```

It is idempotent: it starts the database container, applies migrations, starts the API and web
servers in the background only if their ports are free, and waits until each responds. Pass
`--seed` to also re-run the synthetic seed first (only needed after a fresh database or a changed
`SEED_PASSWORD`).

After it finishes:

1. Report the URLs it printed: app `http://localhost:5173/?week=2026-10-19`, API docs
   `http://localhost:8000/api/v1/docs`.
2. Say to sign in as `employee@example.test` with the `SEED_PASSWORD` from `.env`. Never print the
   password itself.
3. If the script fails, read the tail of `.dev/api.log` or `.dev/web.log` (whichever service it
   named), explain the cause, and fix it if it is a setup problem (missing `.env`, missing
   dependencies, port held by an unrelated process). Do not kill processes you did not start.
