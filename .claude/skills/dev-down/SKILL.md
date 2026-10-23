---
name: dev-down
description: Shut down the TimeTrack local dev environment — stops the web app, the API and the PostgreSQL container (data is kept). Use when the user says dev-down, "stop the app/environment", or is finished running TimeTrack locally.
disable-model-invocation: true
allowed-tools: Bash(scripts/dev-down.sh:*)
---

Stop the local environment by running the project script from the repository root:

```bash
scripts/dev-down.sh $ARGUMENTS
```

It stops only processes that `dev-up` started (tracked in `.dev/*.pid`, and verified to still be
the expected command before anything is killed), frees ports 5173 and 8000 if a leftover dev
server from this project still holds them, then stops the `timetrack-db` container. The database
volume is **kept**, so data survives. Pass `--keep-db` to leave the database running.

After it finishes, confirm what was stopped. Do not run `docker compose down -v` or otherwise
delete the data volume unless the user explicitly asks to wipe the database.
