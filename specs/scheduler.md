# Scheduler: running a workflow

Status: **Built**: the scheduler, delegation, the built-in node types and
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
[ADR-019](../decisions/ADR-019-leaders-resume-on-reentry.md). Of `forEach`
([RFC-013](../rfcs/archived/RFC-013-for-each.md)), holding a node to a declared
list, [the fan-out](./scheduler/for-each.md), resuming per item, item worktrees,
the question about a list over `maxItems` and the walk are built, as are the
Monitor's and the Builder's views of it: `forEach` is built end to end. The
run's token budget, `limits.budgetTokens`
([RFC-015](../rfcs/archived/RFC-015-format-for-several-drivers.md),
[ADR-084](../decisions/ADR-084-budgets-and-quotas-in-tokens.md)), is built.

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
  is taken; only `control.join` waits. A node runs one round at a time: one
  activated while it runs starts once that round has finished.
- A node with `forEach` [runs each item](./scheduler/for-each.md) as its own
  activation inside its one activation, and finishes once.
- **Dead paths.** A node all of whose incoming non-loop edges resolved as not
  taken is **skipped**, and its outgoing edges are not taken. So a join never
  waits on a branch that will not run, and a branch can be skipped in one round
  and run in the next.
- **Rounds.** A node's round is the edges into it resolved since every one last
  did. An edge whose source can't run any more counts as not taken: its source
  is not queued or running, and neither is any node before it along the non-loop
  edges ([routing.ts](../packages/core/src/run/routing.ts), `stranded`). A loop
  edge starts the next round, so it doesn't count. So when a loop goes back to
  one of two builders, the other's edges count as not taken in that round: a
  node only it feeds is skipped, and a join behind it fires. This is decided
  after each node routes, one waiting node at a time in graph order, as each can
  start something ([tests](../packages/core/test/rounds.test.ts)). A node's
  output after a round is that round's report, except the fields its
  `output.gather` names, which hold every round's entries, a failed round's
  included. A child a leader delegates to gathers across its delegations, from
  its last report before a resume too; a spawned instance gathers only its own
  run, since the leader's next round reuses its id for another worker
  ([tests](../packages/core/test/gather.test.ts)).
- The run ends when nothing runs and nothing waits. A node still waiting then,
  neither run nor skipped with an edge into it resolved, would be a bug in Ork:
  the run ends `failed`, its reason starting `ork engine error:` and naming the
  node and what it waited on, never `succeeded`. It is a failure, not a thrown
  assertion, so the run still ends, records `run.finished` and stays readable
  and resumable like any failed run.

## Edges

- **Without `when:`** an edge is taken when its source **succeeded**: a Claude
  report whose status is not `fail`, a tool exit code of 0, any control node, an
  answered gate.
- **With `when:`** the [expression](./expressions.md) decides, read against the
  source's output (bare names read `output`) and `ok`, how it ended, unless it
  reports a field of that name. So `when: "!ok"` handles any failure, including
  one that leaves no field to test, and `when: status == 'fail'` handles a
  failure.
- A node that failed and took no edge fails the run (its reason is in the run
  summary); other branches still finish. One that failed and took an edge (a
  handled failure), and a skipped node, leave the run `succeeded`, and the
  result counts both (`failuresHandled`, `skipped`).
- **What a node declares holds.** A value that doesn't fit an `output.schema` (a
  missing field, the wrong type, a value off the list) fails the node, with a
  reason that names all three, as in
  `state is "DRAFT", expected OPEN or CLOSED`. For a tool it's the JSON's
  fields, for an `mcp.call` the result's, and for an agent node its report's; a
  Claude field written as JSON Schema stays the driver's to enforce
  ([ADR-052](../decisions/ADR-052-conditions-from-declared-outputs.md)). A
  declared list, `{ list: { <field>: <rule> } }`, is held to being a list
  (`tasks is "fix it", expected a list`), and when it has an item shape each
  item is too; the reason names the first bad item by its index
  (`tasks[1].title is missing, expected text`). Ork checks this itself, on every
  driver, and an agent node's report schema carries it as `type: array` with
  `items`. An item's extra fields are refused by the report schema and ignored
  by a tool's or MCP call's check, as a result's extra fields are
  ([declared.ts](../packages/core/src/run/declared.ts),
  [RFC-013](../rfcs/archived/RFC-013-for-each.md)).

## Control nodes

| Node             | What it does                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `control.split`  | passes its input through; every outgoing edge is decided as usual                                                                                |
| `control.router` | passes its input through; `mode: first` (default) takes only its first edge whose `when:` holds, `all` every one                                 |
| `control.join`   | `all` fires once every input resolved; `any` on the first input that ran (once per round); `n` after `n` ran; skipped when not enough inputs ran |

A join outputs `statuses` (the `status` of each input that ran, in edge order),
`results` (input id → output) and `count`. An input that can't run any more in
the round counts as resolved and not taken ([rounds](#activations)), so a join
in a later round doesn't wait on a branch the loop didn't go back to.

## Loops

- Every cycle has a `maxRounds` edge (the compiler checks it); removing those
  edges leaves a DAG, and dead paths only travel along the DAG.
- A loop edge whose condition holds is taken until it has been taken `maxRounds`
  times in the run. Then the run emits `loop.exhausted` and asks: **stop** the
  run (recommended, and the answer when no one is at the terminal), allow **one
  more round**, or go **onward** along the other edges. Once the run stops, for
  this or any reason, the node's remaining edges aren't followed and nothing new
  starts.
- **Who is asked** ([escalation.ts](../packages/core/src/run/escalation.ts)):
  the owner of the loop's nodes (of `from`, else of `to`) while its session is
  live, through the [message bus](./messaging.md#message-bus); the node runs in
  the flow, so its owner is not waiting on it. Otherwise, or when the owner's
  session ends before it answers, the `HumanChannel` gets it as a decision. A
  child's `ask_user` goes to the person too, unless its leader sets
  `questions: owner`: then a fork of the leader's session answers it or passes
  it on ([leader questions](./messaging/leader-questions.md)).
- A re-entered **worker** starts a fresh session whose brief ends with a
  `## Round n` section carrying its input (e.g. the join's `statuses` and
  `results`), so reviews stay unbiased. Past 8 KiB the section shows the start
  and the session reads the whole with `read_input` (ADR-078).
- A re-entered **leader resumes** its last session (ADR-019) with only the new
  round's input as the next message, keeping its context and cache. The same
  holds when a leader is delegated to again.
- `session: resume` or `fresh` on a leader or worker (or its agent) chooses
  either way ([ADR-033](../decisions/ADR-033-session-resume-on-any-node.md)): a
  reviewer with `session: resume` checks its own earlier findings in each round
  ([results.ts](../packages/core/src/run/results.ts), `resumeOf`).

## Delegation

An `agent.leader` inside a run gets two blocking tools (ADR-017); both take a
list of tasks, run them in parallel, and return when every child has reported:

- **`delegate([{ child, brief }])`** runs declared children (its own
  `agent.leader`/`agent.worker` children). The child's session gets its own
  `prompt` followed by `## Task from \`<leader>\`` and the brief.
- **`spawn_worker([{ template, brief }])`** runs a new instance of a child
  worker, `<template>-2`, `-3`, …, up to the leader's `maxWorkers` (default 0,
  and then the tool is not offered). An instance works like its template: same
  settings, its own worktree, owned by the leader.
- The tools' arguments are bound to the leader: `child` is an enum of its child
  leaders and workers, `template` of its child workers, and a task object takes
  no other key. A wrong argument is an error and no task runs: `path: message`
  per issue, and a stray key as
  ``tasks[0]: unknown field `node`; the field is `child`, one of: code, tests``,
  field and ids read from the schema.
- A task is refused, with the reason in its report, when its child is already
  running (in the flow or for another call), or no workers are left. A child the
  leader does not own is not a refused task: it is a wrong argument, so the
  whole call fails at its arguments, with the valid ids, and no task runs.
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
- **Claims.** Once a call accepts a task, the leader's claims are released so
  its children can take them, and the result's notes name them; the leader
  claims again before it edits ([messaging](./messaging.md#claims)).
- `node.started` carries `owner` for a delegated run; the run summary lists
  spawned workers by their instance id.

## Built-in node types

From `@krapht/ork-nodes` ([builtins.ts](../packages/nodes/src/builtins.ts)):

- **`agent.leader`, `agent.worker`**: one session through the
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
  the full text is written to `.ork/runs/<run>/<node>.<round>.<stream>.txt`
  (`<node>.<round>.<step>-<try>.<stream>.txt` for a `before:` or `verify:` step,
  so neither a step nor a check's next try overwrites it).
  - **Who it is:** the program inherits Ork's environment, with `ORK_RUN`,
    `ORK_NODE`, `ORK_ROUND`, `ORK_RUN_DIR`, `ORK_PROJECT`, `ORK_WORKFLOW` and,
    when `ork` can be run directly, `ORK_BIN`
    ([ADR-047](../decisions/ADR-047-script-identity-env-json.md)). An item of a
    `forEach` node also gets `ORK_ITEM` (a string as it is, anything else as
    JSON) and `ORK_INDEX`; the scheduler starts items with them
    ([RFC-013](../rfcs/archived/RFC-013-for-each.md)). Then the node's `env:`,
    rendered. A variable that is not set stops `ork run` before anything starts;
    for a workflow it calls by name, it warns, and the call fails if reached
    ([L86](./messaging/scripts-limits.md)). Events record `env:` names only.
    Values read from `{{env.*}}` by the workflow, by those it calls by name, or
    by its callers (told as names in `ORK_MASKED`), except those in `plainEnv`,
    are scrubbed from every tool node's output, in any form a JSON encoder
    writes them, including JSON keys and numbers
    ([L81](./messaging/scripts-limits.md)). A Claude session inherits the user's
    variables like any program, without these, and also gets `ORK_SESSION=1`. A
    detached run's programs and sessions also see `ORK_DETACHED=1`.
  - **Watching:** with [`watch:`](./scheduler/watching.md) it also gets
    `ORK_STATE`, a file kept between looks.
  - **JSON:** with `output: { format: json }` it also gets `ORK_OUTPUT`, a file
    in the run's private `.output` folder, which wins over stdout if written. On
    exit 0, invalid or empty JSON or anything but a file there fails the node,
    and a result over 64 KiB fails it and is kept in a run file, never cut. A
    failed program's result is not read. A run clears the folder when it starts,
    resumes and ends ([L85](./messaging/scripts-limits.md)).
- **`mcp.call`** ([mcp-call.ts](../packages/nodes/src/mcp-call.ts)): calls one
  tool on a server from the project's `.mcp.json`, with no session
  ([steps](./scheduler/steps.md#mcp-calls)). Its output is `text` and `json`.
- **`workflow.call`** ([call.ts](../packages/nodes/src/call.ts)): starts a
  workflow as a separate run and waits as it says
  ([calling workflows](./scheduler/calls.md)).
- **`human.gate`** ([gate.ts](../packages/nodes/src/gate.ts)): asks the rendered
  `question`, with its rendered `document` if not blank, both in
  [readable mode](./expressions.md#semantics); with `timeout` and `default`, the
  default answers when the time is up and the question is withdrawn. The output
  is `choice`, `answeredBy` (`user` or `timeout`) and `note`: what the person
  said with their answer, an empty string when they said nothing or the timeout
  answered ([decision notes](./messaging.md#decisions)).

## Budget and concurrency

- A result counts for what its activation spent: a resumed session's cost is cut
  down to what it added ([usage](./usage.md#what-a-resumed-session-spent)).
  `ork resume` goes on from all the run had spent, failed nodes included.
- `limits.budgetUsd` caps the run: each session starts with
  `min(node budget, what is left)` ([L73](./usage/ledger-limits.md)), and once
  it is spent no session or [call](./scheduler/calls.md) starts and the run ends
  `budget_exhausted`. A session sets its cap aside as it starts, so sessions
  running together are never offered the same part; one with nothing left waits
  for a worker beside it to finish, never for a leader
  ([ADR-077](../decisions/ADR-077-reserve-session-caps.md)).
- `limits.budgetTokens` caps the run in counted tokens (input, output and cache
  write) on any driver, the same way and beside the dollars: reserves hold both,
  a session that doesn't fit is refused ("nothing is left of the run's tokens"),
  and a resumed run starts from the tokens already used. Neither unit converts
  to the other; whichever is reached first ends the run
  ([tokens](./usage/tokens.md#where-a-token-cap-applies)). A `workflow.call`
  passes no token budget to its run ([L278](./gaps/budget-tokens-limits.md)).
- [Quotas](./usage.md#limits-across-runs) cap what runs spend together: a
  session also gets no more than what is left of them (`quotas.dayTokens` too,
  [tokens](./usage/tokens.md#the-token-quota)), and at one a run ends
  `quota_exhausted`.
- `limits.concurrency` (default 4) caps the Claude sessions running at once;
  other nodes are not limited, except
  [a fan-out's](./scheduler/for-each.md#pacing-and-failure) items by
  `maxParallel`. The cap is per run: runs don't share it, and nothing limits how
  many runs of one workflow go at once ([L39, L43](./scheduler/limits.md)).
- `interrupt()` stops starting nodes, aborts the running ones, stops the runs
  its calls started, and ends the run `interrupted`.

## Timeouts

[timeouts.ts](../packages/core/src/run/timeouts.ts),
[tests](../packages/core/test/timeouts.test.ts),
[ADR-043](../decisions/ADR-043-timeouts.md).

- `timeout` on a tool node, `agent.leader`, `agent.worker`, `mcp.call` or
  `workflow.call` limits each activation, from when its executor starts;
  `defaults.timeout` applies to those that set none; `limits.timeout` limits the
  run. None is set unless a workflow sets it.
- **The clock measures work.** It stands still while the node is paused or has a
  question or permission prompt open, and while a node it owns does. A run's
  stands still while it is paused, or anything in it waits on the user.
- **An expired node** is aborted and fails, its output keeping what it had plus
  `status: fail`, `summary` and `timedOut: true`. Edges treat it as any failure.
  If its executor has not ended 10 seconds later it is left behind.
- **An expired run** aborts what is running and ends `timed_out`, after the same
  10 seconds at most.
- On a real session (claude-code driver, 2026-11-03) a 25-second timeout ended
  the session within a second, its background command was gone, and a
  `when: timedOut` edge ran.
- A tool runs in its own process group: an abort, from a timeout or a stop,
  sends it SIGTERM, then SIGKILL after 2 seconds
  ([spawn.ts](../packages/nodes/src/spawn.ts)). Off Windows the group also ends
  with `ork`: a watcher in it reads a pipe from `ork`, and when `ork` dies by
  any cause (SIGKILL, the OOM killer, a crash) it sends the group SIGTERM, then
  SIGKILL after 2 seconds, so a node never runs on after the lock or slot of its
  run is handed on. When the node ends normally the watcher is stopped first, so
  background processes it leaves behind are left alone
  ([orphan-guard.ts](../packages/core/src/machine/orphan-guard.ts),
  [ADR-087](../decisions/ADR-087-node-processes-end-with-ork.md); sessions:
  [runtime](./runtime.md#how-a-session-is-spawned)).

## Contents

- [Calling workflows](./scheduler/calls.md)
- [Running a node once per item](./scheduler/for-each.md)
- [Steps around a session](./scheduler/steps.md)
- [Resuming a run, and run events](./scheduler/resuming-and-events.md)
  - [Resuming a run](./scheduler/resuming-and-events.md#resuming-a-run)
  - [Run events](./scheduler/resuming-and-events.md#run-events)
- [Watching a source](./scheduler/watching.md)
- [Walking every way through](./scheduler/walking.md)
- [Limits: running, resuming and stopping](./scheduler/limits.md)
- [Limits: workflows calling workflows](./scheduler/calls-limits.md)
- [Limits: watching a source](./scheduler/watching-limits.md)
- [Limits: walking a workflow](./scheduler/walking-limits.md)
