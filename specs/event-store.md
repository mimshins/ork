# Event store: what a run keeps

Status: **Built**: the store, the recorder, decisions and commands, `ork ps`,
`ork logs` and `ork tree` ([store/](../packages/core/src/store/sqlite.ts),
[tests](../packages/core/test/store.test.ts),
[CLI tests](../packages/cli/test/runs.test.ts)), with messages, `ork chat`'s
exchanges, resumed runs, claims, feedback records and each run's process start
([tests](../packages/core/test/process-start.test.ts)), and item ids (`build.2`)
read as instances of their node
([tests](../packages/core/test/item-ids.test.ts)). Why:
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
  workflow name, workflow file and project root (absolute), the process id and
  that process's start, status, start and finish times, and the cost so far. A
  run a [`workflow.call`](./scheduler/calls.md) started also has its `parent`
  run, and its `depth` below the run that started it all. A finished run also
  has `skipped` and `failuresHandled`, copied from its `run.finished` result;
  they are absent while it runs (a resume clears them) and for runs recorded
  before they were counted.
- **Status:** `running` until `run.finished` is written, then that event's
  status (`succeeded`, `failed`, `budget_exhausted`, `quota_exhausted`,
  `timed_out`, `interrupted`). A `running` run whose process is gone reads as
  **`crashed`**, wherever liveness is checked (`ork ps`, `ork stop`, the panels,
  `ork worktrees`, `ork prune`, an upgrade).
- **Whose process:** a process id comes round again (after a reboot, or to
  another user's process), so the run records its process's start with its id
  when it begins and when it is resumed, and a live process with the id but
  another start is not the run's: the run reads as `crashed`. On Linux the start
  is `/proc/<pid>/stat`'s clock ticks since boot, with the boot's id (exact, and
  not moved by the clock); elsewhere, macOS included, it is `ps -o lstart=` read
  in UTC, to the second, so two starts a second apart are one process. A check
  reuses a start read in the last second only when it matched; a mismatch is
  read again. An id of 0 or below, or not a whole number, names no process.
  Where the start can't be read, and for a run recorded before starts were
  (migration 14 adds the column, empty for them), a live process with the id
  counts, as before
  ([store/process-age.ts](../packages/core/src/store/process-age.ts)).
- **Plan limits:** `plan_limits` keeps what Claude Code last said of each of a
  plan's limits, written with its event, across runs
  ([usage](./usage.md#limits-across-runs)).
- **An event:** the run, a sequence number (1, 2, 3, … in the run), the time,
  and the [run event](./scheduler/resuming-and-events.md#run-events) itself.
  Events are only appended, never changed.
- **Before the terminal:** each event is stored, then printed (and sent to the
  run's socket followers), so a crash loses at most the event in flight.
- **Workflow drafts:** `workflow_drafts` holds what the
  [builder](./ui/panels-builder-logs-and-decisions.md#builder) hasn't saved: a
  project, a workflow's name, its text, and the hash of the file it began from.
  It's kept here, not in the workflows folder, as a running workflow's call must
  never read an unfinished file. A draft goes when it's saved or discarded;
  `ork prune` leaves it.
- **Triggers:** `triggers` holds what was accepted on this machine, when each
  last looked and what's holding it; `trigger_seen` the keys it has seen, and
  the run each started; and `watch_lock` the one
  [`ork watch`](./scheduler/watching.md#the-process). None of it is in the
  repository, and forgetting a project takes its rows with it.
- **The usage ledger** has a table of its own: one row per finished Claude
  session, written as its event is appended, which outlives the run
  ([usage](./usage.md)).
- **Links** between nodes of live runs have a table of their own
  ([messaging](./messaging/links.md)); `relay` and `notice` commands carry what
  crosses them.
- **Decisions and commands** have tables of their own: a decision's question,
  options, recommended option, masked `document`, when a gate gave one
  ([migration 18](./messaging.md#decisions); empty for older decisions, which
  read without the key, and never in `decision.opened`), status (`open`,
  `answered`, `withdrawn`), answer, who answered, and the masked
  [note](./messaging.md#decisions) they gave with it (migration 16 adds the
  column, empty for older answers), and the leader that took a child's question
  first, as `owner`
  ([migration 17](./messaging/leader-questions.md#who-answered)); a command's
  kind (`stop`, `pause` and `continue`, each with an optional node; `message`
  from `ork chat` with its node and masked body; or `relay`, `script` from
  `ork send`, and `notice`, likewise, the first two with their sender) and when
  the run handled it. The run events `decision.opened`, `decision.answered`,
  `decision.withdrawn` and `run.command` record the same in the run's stream
  ([messaging](./messaging.md)).
- **A resumed run** (`ork resume`) is the same run: its record is `running`
  again in the new process, with that process's id and start, and its events go
  on from the last sequence number, starting with `run.resumed`.
- **After `run.finished`**, only `ork chat` adds events: the exchange with a
  resumed session. The run's status and cost stay as they were.
- **A run that never starts** (an invalid workflow, a missing input or program,
  an unclean checkout) is not recorded.

## Masking

Strings in every stored event, and in the JSONL copy, are masked before they are
written ([mask.ts](../packages/core/src/store/mask.ts)): Anthropic, GitHub, AWS
and Slack tokens, private keys, bearer tokens, and `aws_secret_access_key = …`.
The terminal shows the unmasked transcript, which is the user's own; a gate's
`question`, `context` and `document` reach the terminal masked, as stored.
Feedback records use the same patterns.

## Reading runs

- **`ork ps`** lists this project's runs, newest first: id, workflow, status,
  when it started and for how long, and cost. A called run's cost is dimmed and
  says `in <caller>`: the caller's cost already counts it, so the column adds up
  to what was spent. `--all` lists every project's, with the project;
  `--limit n` (default 20); `--json` prints the run records, `skipped`,
  `failuresHandled` and `parent` included.
- **`ork logs [<run>]`** prints the run's transcript, line for line what
  `ork run` printed. `--node <id>` keeps one node's events; `--follow` (`-f`)
  keeps printing a live run's events, pushed over the run's socket (or polled
  every 250 ms without one), until it finishes or its process is gone; `--json`
  prints the stored events.
- **`ork tree [<run>]`** draws the ownership tree from `run.started`'s declared
  nodes, with spawned workers (`<template>-<n>`) under the leader that spawned
  them, and the items of a fanned node (`<node>.<n>`, RFC-013) under that node
  with `template` set to it (`nestItems`, which the server's run tree uses too;
  `runTree` keeps the shape the events give): each node's state (waiting,
  running, ok, failed, skipped), its verdict, how many times it ran, tokens and
  cost, and for a fanned node `listed`, the count of its latest `each.listed`.
  An `each.listed` of a higher round than the node's last sets its items back to
  `waiting` until each starts again; one of the same round (a resume, or a list
  cut to `maxItems`) leaves them. `--json` prints the tree.
- `<run>` is an id or a unique prefix of one; without it, this project's newest
  run. An ambiguous prefix lists the matches.
- **`ork usage`** adds up what sessions spent over time, and **`ork prune`**
  forgets old runs while keeping that ledger and their feedback
  ([usage](./usage.md)).
- **Feedback** is recorded with the run: each `feedback.recorded` event is also
  a row in the `feedback` table, grouped by fingerprint into `feedback_items`,
  which triage can merge into one another (`merged_into`, migration 13)
  ([feedback](./feedback.md)); `ork feedback` reads them.
