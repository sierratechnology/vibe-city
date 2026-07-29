# Local Authenticated Work-Record Prototype

This Milestone 3 prototype adds a local-only, authenticated ingestion boundary and a public-safe read projection to Vibe City. It is a candidate foundation for hosted-agent state; it is not deployed and does not publish private Kanban task bodies.

## Runtime requirements

- Node.js 22 or newer (`node:sqlite` is used for the local SQLite store)
- npm
- A unique local bearer token generated at runtime

## Work-event contract v1.0

The ingestion endpoint accepts exactly these fields and rejects unknown or missing fields:

| Field | Meaning |
| --- | --- |
| `version` | Contract version; only `1.0` is accepted |
| `eventId` | Stable opaque idempotency key matching `evt_` plus 32–64 lowercase hexadecimal characters |
| `sourceType` | `hermes_kanban` |
| `workRef` | One-way redacted reference matching `public-` plus 16–64 lowercase hexadecimal characters; raw task IDs are rejected |
| `profileId` | Publicly registered profile identifier; v1.0 permits `ariadne` and `spiders` only |
| `eventKind` | `task_assigned`, `task_started`, `status_changed`, `blocked`, `completed`, or `review_requested` |
| `status` | `ready`, `running`, `blocked`, or `done` |
| `occurredAt` | Canonical ISO-8601 UTC timestamp for the source event |
| `observedAt` | Canonical ISO-8601 UTC timestamp when ingestion observed it |
| `summary` | Server-approved state label consistent with `eventKind` and `status` |

Chronology must satisfy `occurredAt <= observedAt <= ingestion time`. The only accepted summaries are `Assigned work is ready.`, `Work is in progress.`, `Work is blocked pending input.`, `Work is complete.`, and `Work is ready for review.`, with valid event/status combinations enforced. This closed vocabulary prevents task text, prompts, logs, paths, tool arguments, credentials, and secrets from entering the public projection. Duplicate event IDs return `409` without changing the original record.

## Start the prototype

Install and build:

```sh
npm ci
npm run build
```

Create a runtime-only token without printing it, choose a loopback port, and start the production bundle plus API:

```sh
umask 077
mkdir -p .runtime
openssl rand -hex 24 > .runtime/work-record-token
export VIBE_WORK_RECORD_TOKEN="$(<.runtime/work-record-token)"
export VIBE_WORK_RECORD_DB="$PWD/.runtime/work-records.sqlite"
export VIBE_WORK_RECORD_PORT=4173
npm start
```

For Vite development mode, use the same environment and run `npm run dev`. The server rejects non-loopback bind addresses and non-loopback HTTP `Host` headers. If the token is absent, reads remain available but every ingestion attempt fails closed. The SQLite file is forced to owner-only mode (`0600`) inside the runtime directory.

## Ingest verified current Hermes/Kanban runtime state

From a Hermes Kanban worker, `HERMES_KANBAN_TASK` and `HERMES_PROFILE` are runtime metadata. The helper hashes the task ID into a stable redacted `workRef`; it never sends or prints the bearer token or raw task ID.

```sh
export VIBE_WORK_RECORD_TOKEN="$(<.runtime/work-record-token)"
export VIBE_WORK_RECORD_ENDPOINT="http://127.0.0.1:${VIBE_WORK_RECORD_PORT}/api/work-events"
node scripts/ingest-current-kanban-event.mjs
```

The helper records the verified current worker as `running`, derives a deterministic event ID from task/profile/state, and emits only the approved `Work is in progress.` label. It refuses non-HTTP, non-loopback, credential-bearing, query-bearing, or alternate-path endpoints before attaching the bearer token. It is intentionally unsuitable for arbitrary user-entered task descriptions.

## Database schema and migration

Fresh databases use SQLite `user_version = 2`. Version 2 records a server-generated `accepted_at` timestamp alongside each validated event. Opening a version-1 database performs a single transaction that copies every existing event into the version-2 table, preserves all public event fields, derives `accepted_at` from the prior `observed_at`, replaces the old table, and advances `user_version` only when the transaction succeeds. Unsupported future schema versions are rejected rather than guessed or rewritten.

## Verify persistence and read projection

```sh
curl --fail --silent --show-error \
  "http://127.0.0.1:${VIBE_WORK_RECORD_PORT}/api/work-events?limit=20"
```

The read endpoint returns at most 50 allowlisted events ordered by observation time, total accepted count, newest source timestamps, generation time, and `recent`, `stale`, or `empty` freshness. Before reporting counts, timestamps, freshness, or any event, it revalidates every persisted row that contributes to those aggregate claims. One invalid stored row makes the entire projection fail closed. Freshness uses the newest validated observation across the durable store. It never returns the bearer token, prompts, tool arguments, raw logs, task bodies, filesystem paths, email addresses, or raw Kanban task IDs.

Stop and restart `npm start` with the same `VIBE_WORK_RECORD_DB`, then repeat the GET to verify durable SQLite persistence.

## Verify the Records Terminal

1. Open the local Vibe City URL and enter World Zero.
2. Enter STG Headquarters and use the contextual Records Terminal in the Records Room.
3. Select **Refresh record**.
4. Confirm **Authenticated Local Work Records** shows the event, source, and freshness.
5. Confirm the existing **Public Repository Record** remains present.

The interface explicitly renders empty, offline, invalid/error, clock-error, recent, and stale states. An unavailable or invalid client clock produces `clock_error` with no fabricated observation timestamp. Event rows are created with `textContent`; untrusted summaries are never interpreted as markup.

## Automated verification

```sh
node --disable-warning=ExperimentalWarning --test tests/work-records-server.test.mjs tests/work-records-api.test.mjs tests/work-records-ui.test.mjs
NODE_OPTIONS=--disable-warning=ExperimentalWarning npm test
npm run build
```

## Local evidence from this task

Runtime-only evidence is intentionally ignored by Git:

- `.runtime/ingest-evidence.json` — accepted event ID, redacted work reference, and observed timestamp
- `.runtime/read-evidence.json` — persisted privacy-safe read projection
- `.runtime/read-evidence-after-restart.json` — the same event after a real server stop/start cycle
- `.runtime/work-records.sqlite` — local durable store; contains operational event data and must not be committed

These files are local verification artifacts, not release assets. Delete `.runtime/` to reset the prototype after review.

## Known prototype constraints

- `node:sqlite` remains experimental in the current Node runtime; this is a local candidate foundation, not production persistence.
- Public profile and summary vocabularies are intentionally closed in v1.0. Adding an agent or a public state label requires a reviewed contract change.
- The API is loopback-only and uses one local bearer token. Hosted deployment requires a separate identity, authorization, tenant-isolation, key-rotation, and audit design.
