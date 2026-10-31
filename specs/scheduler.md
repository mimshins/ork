# Scheduler: running a workflow

Status: **Partial**: the scheduler, delegation, the built-in node types and
`ork run <wf>` are built ([scheduler.ts](../packages/core/src/run/scheduler.ts),
[routing.ts](../packages/core/src/run/routing.ts),
[delegation.ts](../packages/core/src/run/delegation.ts),
[nodes](../packages/nodes/src/index.ts),
[tests](../packages/core/test/scheduler.test.ts),
[delegation tests](../packages/core/test/delegation.test.ts),
[node tests](../packages/nodes/test/nodes.test.ts)), and so is resuming a run
([resume.ts](../packages/core/src/run/resume.ts),
[tests](../packages/core/test/resume.test.ts)); where each node works is
[Worktrees](./worktrees.md). Why:
[ADR-016](../decisions/ADR-016-scheduler-semantics.md),
[ADR-017](../decisions/ADR-017-blocking-delegate.md),
[ADR-019](../decisions/ADR-019-leaders-resume-on-reentry.md).

`startRun({ graph, inputs, cwd, executors, human, onEvent, workspace })` runs a
compiled workflow ([graph compiler](./graph-compiler.md)) and returns
`{ runId, done, interrupt }`. The engine only knows ports: each node type's
`NodeExecutor` (from `@krapht/ork-nodes`), the `HumanChannel`, an `onEvent`
sink, and an optional `Workspace` that gives each node its checkout and handles
its branch afterwards ([worktrees](./worktrees.md)).

## Activations

- A node runs once per **activation**. The entries activate when the run starts.
- When a node finishes, each outgoing edge is **taken** or **not taken**
  (below). A taken edge activates its target, with the source's output as the
  target's input. A node with several incoming edges runs whenever any of them
  is taken; only `control.join` waits.
- **Dead paths.** A node all of whose incoming non-loop edges resolved as not
  taken is **skipped**, and its outgoing edges are not taken. So a join never
  waits on a branch that will not run, and a branch can be skipped in one round
  and run in the next.
- The run ends when nothing runs and nothing waits.

## Edges

- **Without `when:`** an edge is taken when its source **succeeded**: a Claude
  report whose status is not `fail`, a tool exit code of 0, any control node, an
  answered gate.
- **With `when:`** the [expression](./expressions.md) decides, read against the
  source's output (bare names read `output`), so `when: status == 'fail'`
  handles a failure.
- A node that failed and took no edge fails the run (its reason is in the run
  summary); other branches still finish.

## Control nodes

| Node             | What it does                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `control.split`  | passes its input through; every outgoing edge is decided as usual                                                                                |
| `control.router` | passes its input through; `mode: first` (default) takes only its first edge whose `when:` holds, `all` every one                                 |
| `control.join`   | `all` fires once every input resolved; `any` on the first input that ran (once per round); `n` after `n` ran; skipped when not enough inputs ran |

A join outputs `statuses` (the `status` of each input that ran, in edge order),
`results` (input id → output) and `count`.

## Loops

- Every cycle has a `maxRounds` edge (the compiler checks it); removing those
  edges leaves a DAG, and dead paths only travel along the DAG.
- A loop edge whose condition holds is taken until it has been taken `maxRounds`
  times in the run. Then the run emits `loop.exhausted` and asks: **stop** the
  run (recommended, and the answer when no one is at the terminal), allow **one
  more round**, or go **onward** along the other edges.
- **Who is asked** ([escalation.ts](../packages/core/src/run/escalation.ts)):
  the owner of the loop's nodes (of `from`, else of `to`) while its session is
  live, through the [message bus](./messaging.md#message-bus); the node runs in
  the flow, so its owner is not waiting on it. Otherwise, or when the owner's
  session ends before it answers, the `HumanChannel` gets it as a decision.
- A re-entered **worker** starts a fresh session whose brief ends with a
  `## Round n` section carrying its input (e.g. the join's `statuses` and
  `results`), so reviews stay unbiased.
- A re-entered **leader resumes** its last session (ADR-019) with only the new
  round's input as the next message, keeping its context and cache. The same
  holds when a leader is delegated to again.
- `session: resume` or `fresh` on a leader or worker (or its agent) chooses
  either way ([ADR-033](../decisions/ADR-033-session-resume-on-any-node.md)): a
  reviewer with `session: resume` checks its own earlier findings in each round
  ([results.ts](../packages/core/src/run/results.ts), `resumeOf`).

## Delegation

A `claude.leader` inside a run gets two blocking tools (ADR-017); both take a
list of tasks, run them in parallel, and return when every child has reported:

- **`delegate([{ child, brief }])`** runs declared children (its own
  `claude.leader`/`claude.worker` children). The child's session gets its own
  `prompt` followed by `## Task from \`<leader>\`` and the brief.
- **`spawn_worker([{ template, brief }])`** runs a new instance of a child
  worker, `<template>-2`, `-3`, …, up to the leader's `maxWorkers` (default 0,
  and then the tool is not offered). An instance works like its template: same
  settings, its own worktree, owned by the leader.
- A task is refused, with the reason in its report, when the child is not the
  leader's, is already running (in the flow or for another call), or no workers
  are left.
- A delegated run reports only to its leader: it follows none of the child's
  edges. A child with incoming edges still runs when they are taken (ADR-008).
- **Reports.** Each is the child's output (`status`, `summary`, `artifacts`,
  `branch`, and `merge` on a conflict) with its cost; a failed child is a report
  with `ok: false`, for the leader to handle. Before the children start, Ork
  commits the leader's work, so they branch from it, and merges each passing
  child into the leader's branch ([worktrees](./worktrees.md#delegation)).
- **Slots.** While a leader waits, its session slot goes to its children, so a
  leader never deadlocks at `concurrency: 1`; children and returning leaders are
  served before queued activations. Children count against the run's budget, and
  none starts once it is spent.
- `node.started` carries `owner` for a delegated run; the run summary lists
  spawned workers by their instance id.

## Built-in node types

From `@krapht/ork-nodes` ([builtins.ts](../packages/nodes/src/builtins.ts)):

- **`claude.leader`, `claude.worker`**: one session through the
  [runtime](./runtime.md), planned with the run's outputs so
  `{{nodes.<id>.output.*}}` renders. The output is the report: `status`,
  `summary`, `artifacts`, `branch`, `usage` and the `output.schema` fields. A
  session without a valid report outputs `status: fail`.
- **`tool.<id>`**, one per registered integration (`gh`, `aws`, `shell`;
  [integrations](../packages/integrations/src/registry.ts),
  [tools.ts](../packages/nodes/src/tools.ts)): `command` is split like a shell
  would (quotes, `\`, `{{ … }}` kept whole), with no shell; each argument is
  then rendered, so a value never becomes extra arguments. With `allow`, the
  command must start with one of its prefixes (`tool.shell` checks the program
  too) or the node fails before running. `gh` and `aws` are the user's own, with
  their own logins; `profile` and `region` become `--profile` and `--region`.
  The output is `exitCode`, `stdout`, `stderr`; over 64 KiB, a stream is cut and
  the full text is written to `.ork/runs/<run>/<node>.<round>.<stream>.txt`.
- **`human.gate`** ([gate.ts](../packages/nodes/src/gate.ts)): asks the rendered
  `question`; with `timeout` and `default`, the default answers when the time is
  up and the question is withdrawn. The output is `choice` and `answeredBy`
  (`user` or `timeout`).

## Budget and concurrency

- `limits.budgetUsd` caps the run: each session gets
  `min(node budget, what is left)`, and once it is spent no session starts and
  the run ends `budget_exhausted`.
- `limits.concurrency` (default 4) caps the Claude sessions running at once;
  other nodes are not limited.
- `interrupt()` stops starting nodes, aborts the running ones, and ends the run
  `interrupted`.

## Resuming a run

`ork resume` ([CLI](./cli/running-and-runs.md#resuming-a-run),
[ADR-026](../decisions/ADR-026-resume-by-replay.md)) runs the workflow again
under the same run id, with a `Replay` built from the run's events:

- Each flow activation gets the result its node recorded last time, in order,
  without running and without `node.started`/`node.finished`; outputs, rounds,
  leaders' session ids, joins, routers and loop counts are rebuilt as before.
- A node's results are handed back up to its first that failed or never
  finished; from there it runs. A new result marks its output, and an activation
  whose input carries one (directly, or in a join's `results`) runs too.
  Delegated runs are never handed back: their leader's session runs them.
- `run.started` carries the run's `inputs` and `settings` (`inPlace`, `driver`),
  which the resumed run starts with; the CLI records `run.resumed` with the
  nodes that keep results first.
- Questions about loops out of rounds that were answered last time get the same
  answers again, in order.
- The run's budget counts what it spent before.

## Run events

`onEvent` receives every change; `ork run` stores each one in the
[event store](./event-store.md) before printing it:

| Event               | When                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run.started`       | the run starts: id, workflow, entries, every declared node and owner                                                    |
| `node.started`      | an activation starts: id, type, round, `owner` when delegated, and the `agent` that fills it (name, source, file, hash) |
| `node.event`        | a runtime event from the node's session or tool                                                                         |
| `node.finished`     | an activation ends: ok, output, usage, error                                                                            |
| `node.skipped`      | a dead path skips the node                                                                                              |
| `edge.taken`        | an edge is taken                                                                                                        |
| `loop.exhausted`    | a loop edge is out of rounds                                                                                            |
| `worktree`          | a worktree is created, committed to, merged, conflicts, or removed                                                      |
| `message.sent`      | a node wrote to another on the message bus: number, recipient, body                                                     |
| `message.read`      | a node read its inbox: the message numbers                                                                              |
| `owner.asked`       | the run asked a live owner about a loop of a node it owns                                                               |
| `owner.answered`    | the owner answered with `answer`                                                                                        |
| `owner.unanswered`  | the owner's session ended first; the human is asked instead                                                             |
| `user.message`      | `ork chat` wrote to a node: delivered now, queued, or by resuming                                                       |
| `claim.taken`       | a node claimed a resource                                                                                               |
| `claim.refused`     | a claim overlapped another node's: who holds what                                                                       |
| `claim.released`    | a node released a claim, itself or by finishing                                                                         |
| `feedback.recorded` | an agent's report, or a signal Ork derived ([feedback](./feedback.md))                                                  |
| `run.resumed`       | `ork resume` continues the run: the nodes that keep their results                                                       |
| `run.finished`      | the run ends: `succeeded`, `failed`, `budget_exhausted`, `interrupted`                                                  |

The decision queue adds `decision.opened`, `decision.answered`,
`decision.withdrawn` and `run.command` ([messaging](./messaging.md)).

The run result lists each node (runs, ok, last output, cost), the total cost,
the reasons the run did not succeed, and the worktrees it left for the user.
