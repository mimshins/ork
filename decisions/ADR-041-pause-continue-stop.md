# ADR-041 — Pause and continue hold sessions before their next tool call; stopping a node fails it

- **Status:** Accepted
- **Date:** 2026-11-02
- **Topic:** run control / runtime / CLI / server
- **RFC:** waived. The author chose these options over the others below.
- **Builds on:** [ADR-024](./ADR-024-event-store.md) (the store is the source of
  truth; a socket per run is the fast path);
  [ADR-026](./ADR-026-resume-by-replay.md) (resume replays a run)

## Context

The UI's run controls need Play/Pause and Stop for a whole workflow, and for one
node. Until now Ork had one control: `ork stop`, which aborts every running node
and ends the run `interrupted`, so that `ork resume` can replay it later.

The author's requirement for pause: it "should be graceful and don't interrupt
or corrupt or break tasks or workflows". A Claude session can't be frozen in the
middle of a model turn. A turn either finishes, or is interrupted and its work
lost.

## Decision

**Pause holds a session before its next tool call.**

- **The hold point.** A `PreToolUse` hook fires before every tool call,
  pre-approved ones and calls made inside subagents included.
  - **CLI driver:** an HTTP hook (`type: "http"`) is passed in `--settings` and
    points at the session's own endpoint, `/hold`, on the server that serves
    Ork's MCP tools, behind the same bearer token.
  - **SDK driver:** a `PreToolUse` callback hook.
- **While the node is paused,** the hook doesn't answer. The model's turn in
  flight has already finished, and no tool call is aborted; the session simply
  waits.
- **The hold window.** Claude Code cancels a hook at its timeout. A timed-out
  HTTP hook lets the call go ahead, and a timed-out SDK callback hook blocks it.
  So a hold must never reach the timeout. The hook's timeout is 600 s, and a
  hold lasts at most 540 s.
- **A longer pause defers the call** (`permissionDecision: "defer"`):
  1. The turn ends with `stop_reason: "tool_deferred"`, and the call stays
     pending in the session. The process ends.
  2. The node stays running and held in Ork.
  3. When the node continues, the driver resumes the session (`--resume`, or the
     SDK's `resume`) with no new message.
  4. The same call's hook fires again and lets it run.

  The driver yields one session with one result, and its usage is the sum of
  both legs.

- **A paused run starts nothing new.**
  - The scheduler doesn't start queued activations; a delegated child waits
    before it starts.
  - A tool node (`tool.shell`/`gh`/`aws`) runs to its end.
  - A gate stays open and can still be answered, but its timeout counts only
    while it isn't held, so no default answer is chosen during a pause.
  - The run's process stays alive.
- **Pausing a node** applies the same rules to that node alone: its session, and
  its next activations. Continuing the run releases every node's pause.

**Stopping a node fails it.**

- **The mechanism.** Each running activation gets its own abort signal beside
  the run's. `ork stop --node` interrupts that node's session, or kills its
  tool's process.
- **The outcome.** The node finishes `failed` with the reason "stopped by the
  user", and the existing rules apply: its owner gets the failed report, its
  edges don't fire, other branches go on, and a run with nothing left fails.
- **No new outcome type** and no change to the workflow format.

**Plumbing, the way `ork stop` already works.**

- **Commands.** The store's commands gain `pause`, `continue` and a `node` on
  `stop`.
- **Checks.** The sender checks the run's stored events first, so a refusal has
  the CLI's words. Examples: "Run X is already paused.", "N is not running in
  run X."
- **What the run records:**
  - `run.command` (`pause` / `continue` / `stop`, with `node`), when a command
    changed something;
  - `node.held` (`at: "tool" | "start"`), when a node starts waiting;
  - `node.released`, when the hold ends.
- **Views.**
  - `ork ps` shows `paused` for a run paused as a whole (`runStatus`).
  - `ork tree` shows each held node.
  - The API's run view carries `live: "paused"` and `paused`.
- **Surfaces:** `ork pause [run] [--node n]`, `ork continue [run] [--node n]`,
  `ork stop [run] --node n`, and `POST /api/runs/:id/pause`, `/continue` and
  `/stop`, each with `{ node? }`.

**Evidence.** A live test with `claude` 2.1.316 on haiku confirmed each piece:

- the HTTP hook held a call for 75 s, and the tool then ran normally;
- `defer` ended the turn with `tool_deferred`;
- a `--resume` with no message ran the pending call and finished in one turn.

The SDK path follows the SDK's own types (`HookCallbackMatcher.timeout`,
`deferred_tool_use`, `resume`). It wasn't run live: that needs an API key.

## Options considered

- **Pause:**
  - interrupt now and replay on Play (stop plus resume): this loses the turn in
    flight;
  - both a soft and a hard pause: more to build and to explain;
  - hold at the next node boundary only: a long session would never pause.
- **Hold point:**
  - `canUseTool` / the permission prompt tool: it doesn't see pre-approved
    tools;
  - a command hook that blocks on the run's socket: it works too, but costs a
    process per tool call;
  - holding indefinitely with a huge hook timeout: it holds a process and its
    request open for hours.
- **Node stop:**
  - a new `stopped` outcome that edges can test: this changes the format and the
    scheduler;
  - stopping the node's whole subtree.

## Rationale

- **Holding before a tool call is the only point** where a session has nothing
  in flight and every driver gives Ork a say, so pausing can't break work.
- **Deferring is the CLI's own mechanism** for integrations that drive
  `claude -p`. It keeps a long pause free (no process, no open request) and
  resumes exactly where the session stopped.
- **Failing a stopped node reuses rules users already know,** and the owner can
  retry or escalate.

## Consequences

- **A long pause costs a resume.** Claude Code's prompt cache may have expired
  by then; a short pause costs nothing.
- **Managed settings can forbid HTTP hooks** (`allowManagedHooksOnly`,
  `allowedHttpHookUrls`). The CLI driver's hold then never fires, and a
  CLI-driven node pauses only at its next activation
  ([L29](../specs/scheduler/limits.md)).
- **A stopped leader's delegated children** follow the existing owner-failure
  path; they are not stopped with it.
- **Pause and stop work in a full `ork run`.** A single-node run
  (`ork run --node`) still takes only `stop`.
- **The engine's control lives together:** `holds.ts` (holds and stops) and the
  drivers' `hold.ts`. Spec: [run control](../specs/run-control.md).
