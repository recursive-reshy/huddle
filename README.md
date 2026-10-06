# My Team

AI agents (PM, SA) take a project from discovery to an approved PRD and TRD. The design is in `docs/trd.md`.

## Run the stack (Docker Compose, fake agents)

```
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

The API listens on `127.0.0.1:3000` (set `API_PORT` to change it) and keeps its data in `.data/compose`. Stop it with `docker compose -f compose.yaml -f compose.dev.yaml down`.

## Acceptance test (milestone 1.1)

```
cd apps/api
pnpm acceptance          # about a minute; needs Docker
pnpm acceptance --keep   # leave the stack and its data up for debugging
```

It runs against its own Compose project (`huddle-acceptance`), port (3100) and data directory (`.data/acceptance`, wiped at the start of every run), so the dev stack is never touched. It checks three things in fake mode: a message streams deltas and then the PM's `MessageCompleted`; killing `api` mid-job and restarting it re-queues the job, which completes exactly once; and reconnecting with `Last-Event-ID` replays exactly the missed stored events. It exits non-zero if any scenario fails.

After `--keep`, stop it with `docker compose -p huddle-acceptance -f compose.yaml -f compose.acceptance.yaml down`.
