# Event store: what a run keeps

Status: **Built**: the store, the recorder, decisions and commands, `ork ps`,
`ork logs` and `ork tree` ([store/](../packages/core/src/store/sqlite.ts),
[tests](../packages/core/test/store.test.ts),
[CLI tests](../packages/cli/test/runs.test.ts)), with messages, `ork chat`'s
exchanges, resumed runs, claims and feedback records. Why:
[ADR-024](../decisions/ADR-024-event-store.md).

Every run, a whole workflow or one node (`ork run --node`), is recorded as it
happens. The terminal transcript, `ork logs`, `ork tree`, and later the UI are
all views over the same events.

## Where it lives

- **`~/.ork/state.db`**: one SQLite database (Node's built-in `node:sqlite`) for
  every project, in WAL mode, so other `ork` processes read while a run writes.
  Only the run's own process writes its events.
- **`.ork/runs/<run>/events.jsonl`** in the project (an attached project's
  `~/.ork/projects/<id>/runs/`): a copy of the same events, one JSON line each,
  to read, grep or share without Ork. `.ork/runs/` is gitignored.
- **Registered projects** have a table of their own: id, root, mode (`in-repo`
  or `attached`), Ork's folder for it, and when it was registered
  ([projects](./projects.md)).
- The schema is versioned with SQLite's `user_version`; Ork migrates it when it
  opens the store.

## Runs and events

- **A run record:** id (8 hex characters; `node-…` for a run of one node),
  workflow name, workflow file and project root (absolute), the process id,
  status, start and finish times, and the cost so far.
- **Status:** `running` until `run.finished` is written, then that event's
  status (`succeeded`, `failed`, `budget_exhausted`, `interrupted`). A `running`
  run whose process is gone reads as **`crashed`**.
- **An event:** the run, a sequence number (1, 2, 3, … in the run), the time,
  and the [run event](./scheduler.md#run-events) itself. Events are only
  appended, never changed.
- **Before the terminal:** each event is stored, then printed (and sent to the
  run's socket followers), so a crash loses at most the event in flight.
- **Decisions and commands** have tables of their own: a decision's question,
  options, recommended option, status (`open`, `answered`, `withdrawn`), answer
  and who answered; a command's kind (`stop`, or `message` from `ork chat` with
  its node and masked body) and when the run handled it. The run events
  `decision.opened`, `decision.answered`, `decision.withdrawn` and `run.command`
  record the same in the run's stream ([messaging](./messaging.md)).
- **A resumed run** (`ork resume`) is the same run: its record is `running`
  again in the new process, and its events go on from the last sequence number,
  starting with `run.resumed`.
- **After `run.finished`**, only `ork chat` adds events: the exchange with a
  resumed session. The run's status and cost stay as they were.
- **A run that never starts** (an invalid workflow, a missing input or program,
  an unclean checkout) is not recorded.

## Masking

Strings in every stored event, and in the JSONL copy, are masked before they are
written ([mask.ts](../packages/core/src/store/mask.ts)): Anthropic, GitHub, AWS
and Slack tokens, private keys, bearer tokens, and `aws_secret_access_key = …`.
The terminal shows the unmasked transcript, which is the user's own. Feedback
records use the same patterns.

## Reading runs

- **`ork ps`** lists this project's runs, newest first: id, workflow, status,
  when it started and for how long, and cost. `--all` lists every project's,
  with the project; `--limit n` (default 20); `--json`.
- **`ork logs [<run>]`** prints the run's transcript, line for line what
  `ork run` printed. `--node <id>` keeps one node's events; `--follow` (`-f`)
  keeps printing a live run's events, pushed over the run's socket (or polled
  every 250 ms without one), until it finishes or its process is gone; `--json`
  prints the stored events.
- **`ork tree [<run>]`** draws the ownership tree from `run.started`'s declared
  nodes, with spawned workers (`<template>-<n>`) under the leader that spawned
  them: each node's state (waiting, running, ok, failed, skipped), its verdict,
  how many times it ran, tokens and cost. `--json` prints the tree.
- `<run>` is an id or a unique prefix of one; without it, this project's newest
  run. An ambiguous prefix lists the matches.
- **Feedback** is recorded with the run: each `feedback.recorded` event is also
  a row in the `feedback` table, grouped by fingerprint into `feedback_items`
  ([feedback](./feedback.md)); `ork feedback` reads them.
