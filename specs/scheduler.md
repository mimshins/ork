# Scheduler: running a workflow

Status: **Partial**: the scheduler, the built-in node types and `ork run <wf>`
are built ([scheduler.ts](../packages/core/src/run/scheduler.ts),
[routing.ts](../packages/core/src/run/routing.ts),
[nodes](../packages/nodes/src/index.ts),
[tests](../packages/core/test/scheduler.test.ts),
[node tests](../packages/nodes/test/nodes.test.ts)). Delegation and the context
compiler are the rest of M1c; where each node works is
[Worktrees](./worktrees.md). Why:
[ADR-016](../decisions/ADR-016-scheduler-semantics.md).

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
  times in the run. Then the run emits `loop.exhausted` and asks the
  `HumanChannel` (until owners handle it, M1c slice 3): **stop** the run
  (recommended, and the answer when no one is at the terminal), allow **one more
  round**, or go **onward** along the other edges.
- A re-entered Claude node starts a fresh session whose brief ends with a
  `## Round n` section carrying its input (e.g. the join's `statuses` and
  `results`). Leaders will resume their session instead (slice 3).

## Built-in node types

From `@krapht/ork-nodes` ([index.ts](../packages/nodes/src/index.ts)):

- **`claude.leader`, `claude.worker`**: one session through the
  [runtime](./runtime.md), planned with the run's outputs so
  `{{nodes.<id>.output.*}}` renders. The output is the report: `status`,
  `summary`, `artifacts`, `branch`, `usage` and the `output.schema` fields. A
  session without a valid report outputs `status: fail`.
- **`tool.gh`, `tool.aws`, `tool.shell`**
  ([tools.ts](../packages/nodes/src/tools.ts)): `command` is split like a shell
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

## Run events

`onEvent` receives every change; the event store (M1d) will persist the same
events:

| Event            | When                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `run.started`    | the run starts: id, workflow, entries                                  |
| `node.started`   | an activation starts: id, type, round                                  |
| `node.event`     | a runtime event from the node's session or tool                        |
| `node.finished`  | an activation ends: ok, output, usage, error                           |
| `node.skipped`   | a dead path skips the node                                             |
| `edge.taken`     | an edge is taken                                                       |
| `loop.exhausted` | a loop edge is out of rounds                                           |
| `worktree`       | a worktree is created, committed to, merged, conflicts, or removed     |
| `run.finished`   | the run ends: `succeeded`, `failed`, `budget_exhausted`, `interrupted` |

The run result lists each node (runs, ok, last output, cost), the total cost,
the reasons the run did not succeed, and the worktrees it left for the user.
