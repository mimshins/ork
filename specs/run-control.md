# Pause, continue and stop

Status: **Built** ([holds.ts](../packages/core/src/run/holds.ts),
[commands](../packages/core/src/remote/commands.ts),
[drivers' hold](../packages/runtime-claude/src/hold.ts),
[`ork pause`](../packages/cli/src/commands/pause.ts),
[tests](../packages/core/test/holds.test.ts),
[driver tests](../packages/runtime-claude/test/hold.test.ts),
[end to end](../packages/cli/test/control.test.ts),
[API tests](../packages/server/test/control.test.ts)). The UI's buttons are M2
([ui](./ui.md)). Stop, pause and continue reach the items of a `forEach` node
(built; the Monitor doesn't show them yet). Decided in
[ADR-041](../decisions/ADR-041-pause-continue-stop.md).

An item of a fanned node (`build.2`) is a node to these commands; see
[running a node once per item](./scheduler/for-each.md#limits-stop-and-pause).

A live run can be paused and continued, as a whole or one node at a time, and
one of its nodes can be stopped while the rest goes on. Pausing never cuts work
short.

## Contents

- [Commands](#commands)
- [Pause](#pause)
- [Continue](#continue)
- [Stopping one node](#stopping-one-node)
- [What a run records](#what-a-run-records)
- [Limits](#limits)

## Commands

| CLI                             | API                                       | Does                                                       |
| ------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `ork pause [run] [--node n]`    | `POST /api/runs/:id/pause` `{ node? }`    | pauses the run, or one node                                |
| `ork continue [run] [--node n]` | `POST /api/runs/:id/continue` `{ node? }` | releases the run's pause (and every node's), or one node's |
| `ork stop [run] [--node n]`     | `POST /api/runs/:id/stop` `{ node? }`     | stops the run as before, or one running node               |

- **How a command travels.** Each is a command row in the store, then a wake on
  the run's socket, as `ork stop` already is
  ([messaging](./messaging.md#reaching-a-live-run)). The run acts on it at once,
  or at its next look at the store.
- **Checked before it is sent,** against the run's stored events, in the CLI's
  words. The API answers 404 for an unknown node, and 409 for the rest.
  - The run isn't running: `Run X is not running (succeeded).`
  - `Run X is already paused.` / `N is already paused in run X.`
  - `Run X is not paused.` / `N is not paused in run X.`
  - `Run X is paused as a whole; continue the run, not N.`
  - `N is not a node of run X.` / `N is not running in run X.`
- **A run's id or prefix** can be given, as for `ork stop`. With none, the
  command acts on this project's newest run.

## Pause

Nothing is cut short. What happens depends on what the paused part is doing:

- **A Claude session** (leader, worker, and the subagents in it) waits before
  its next tool call. The turn in flight finishes, and the tool call that
  follows waits in a `PreToolUse` hook. The hook fires before every tool call,
  pre-approved ones and Ork's own included.
  - **CLI driver:** an HTTP hook in `--settings` that points at the session's
    `/hold` endpoint, beside Ork's MCP tools, behind the same token.
  - **SDK driver:** a callback hook.
- **A long pause.** A hold that is still paused after 9 minutes (the hook's
  timeout is 10) answers `defer` instead:
  - The turn ends with the call pending, and the `claude` process exits.
  - The node stays running and held.
  - On continue, the driver resumes the session with no new message. The pending
    call runs, and the session goes on, still one session with one result, its
    usage the sum of both legs.
- **Nothing new starts.** Queued activations wait, and so does a leader's
  delegated child before it starts. A tool node (`tool.shell`, `tool.gh`,
  `tool.aws`) runs to its end, and a [`workflow.call`](./scheduler/calls.md)'s
  run goes on ([L56](./scheduler/calls-limits.md)).
- **A gate** stays open, and it can still be answered (`ork decide`). Its
  `timeout` counts only while the gate isn't held: it keeps the time it had
  left, and no default answer is chosen while the run is paused.
- **Messages** to a paused node wait with it. A message sent to a session
  waiting in its hook is read at its next step after continue.
- **The run's process stays alive.** A crash while paused leaves a run that
  `ork resume` replays as usual. The resumed run isn't paused.
- **Pausing one node** applies the same rules to that node alone: its session
  and its next activations, a spawned worker's instances and a fanned node's
  items included. The rest of the run goes on.

## Continue

- **`ork continue` with no node** releases the run's pause, and every node's.
- **`ork continue --node n`** releases one node paused by name. Under a whole
  run's pause, it is refused.
- **What goes on next.** A held session's hook answers at once. A deferred
  session is resumed. Queued activations start.

## Stopping one node

- **What happens.** `ork stop --node n` interrupts the running node's session,
  or kills its tool's process group: SIGTERM, then SIGKILL after 2 seconds, so
  what the tool started ends too ([spawn.ts](../packages/nodes/src/spawn.ts)).
- **Its outcome.** The node finishes `failed`, with the reason
  `stopped by the user`, and the run's own rules take it from there:
  - its owner gets the failed report;
  - edges out of it don't fire;
  - other branches keep running;
  - a run with nothing left to do ends `failed`.
- **No new outcome:** a workflow tests for it as for any failure.
- **A `workflow.call`** has the runs it called stopped too, as does a stop of
  its whole run ([calling workflows](./scheduler/calls.md)).
- **A leader's delegated children** that are still running follow the existing
  owner-failure path; they are not stopped with it.
- **A fanned node** has its running items stopped and starts no more; one item
  named alone (`--node build.2`) stops only it, and `onFailure` decides the
  rest.
- **Only a running node can be stopped:** `N is not running in run X.`

## What a run records

| Event                                       | When                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| `run.command` `{ command, node? }`          | a pause, continue or stop that changed something          |
| `node.held` `{ id, at: "tool" \| "start" }` | a paused node starts waiting: at a tool call, or to start |
| `node.released` `{ id }`                    | its hold ends                                             |

- **`ork logs`** prints them: `‖ paused: its tool call waits for ork continue`,
  `▸ continues`, `! ork pause --node n received`.
- **`ork tree`** marks a held node `‖ paused`. **`ork ps`** shows `paused` for a
  run paused as a whole, and so does the API's run view (`live: "paused"`, and
  `paused: { run, nodes }`).
- **A node's pause is recorded only once it reaches a hold point,** so a node
  paused mid-turn shows `running` until its turn ends.

## Limits

- **Managed settings can forbid HTTP hooks** (`allowManagedHooksOnly`,
  `allowedHttpHookUrls`). Then the CLI driver's hold never fires, and a
  CLI-driven node pauses only at its next activation
  ([L29](./scheduler/limits.md)).
- **The SDK path hasn't run live** (it needs an API key), only against its types
  and the fake runtime ([C5](./runtime.md#limits)).
- **A single-node run** (`ork run <wf> --node n`) takes `stop`, but not pause or
  a node's stop: `ork pause`, `ork continue`, `ork stop --node` and the API's
  routes refuse a `node-…` run with "stop the whole run instead", as links,
  `ork send` and resume already do.
