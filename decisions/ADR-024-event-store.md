# ADR-024 — Runs are recorded in one SQLite store, with a JSONL copy

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / event store
- **RFC:** waived — the author chose the location and the control channel
  directly when the M1d task spec was clarified; the options are below

## Context

Until M1d a run lived only in the terminal that started it. The human loop needs
every run's events kept, readable from any terminal (`ork ps`, `logs`, `tree`),
and a way for other `ork` processes to reach a live run (`ork decide`, `stop`,
`chat`, and runs started with `--detach`).
[specs/messaging.md](../specs/messaging.md) named SQLite at `~/.ork/state.db`
with a JSONL copy per run, without choosing a driver.

## Decision

1. **`node:sqlite`**, built into Node 24.20 (SQLite 3.53, no warning): no new
   dependency, no native build, and it is inside a Node single-executable binary
   ([RFC-002](../rfcs/active/RFC-002-standalone-binaries-and-installer.md)).
2. **One database for every project**, `~/.ork/state.db`, in WAL mode; the run's
   process is its only writer. Each run also writes
   `.ork/runs/<run>/events.jsonl` in its project.
3. **Secrets are masked on write**, in the database and the copy; the terminal
   is not masked.
4. **Other processes reach a live run through the store** (slice 2): they write
   answers and commands as rows, and the run watches for them. A per-run local
   socket is added as a fast path to wake the run and stream events; the store
   stays the source of truth.

Contract: [specs/event-store.md](../specs/event-store.md). Code:
[store/](../packages/core/src/store/index.ts).

## Options considered

- **Driver:** `node:sqlite` (chosen); `better-sqlite3` (a native dependency with
  a build step, against `strictDepBuilds`); JSONL files only (no queries, and
  every reader rescans every run).
- **Location:** one global database (chosen: `ork ps --all` and `ork decide`
  work from anywhere, and feedback spans projects); one per project (history
  goes with the project, but nothing sees across them).
- **Control channel:** through the store (chosen: durable, no port, works for a
  detached or crashed run, and the M2 server reads the same tables); a local
  socket only (instant, but a second channel and nothing survives a crash); M2's
  server early.

## Rationale

The store is the one place every view reads, so it must outlive the process,
work without a server, and need nothing installed. A built-in driver keeps the
supply chain unchanged.

## Consequences

- `~/.ork/state.db` holds prompts, briefs, tool inputs and model text from every
  project, masked; deleting it forgets every run.
- A `running` run whose process died reads as `crashed`; `ork resume` (M1d)
  continues it from its events.
- The store's schema migrates with `user_version`.
