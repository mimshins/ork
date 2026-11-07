# Calling workflows

_Part of [Scheduler: running a workflow](../scheduler.md)._

Status: **Built, proven on real sessions on the CLI driver**; the SDK driver
only against stand-ins ([C5](../runtime.md#limits))
([ADR-045](../../decisions/ADR-045-workflows-calling-workflows.md),
[node](../../packages/nodes/src/call.ts),
[port](../../packages/core/src/remote/calls.ts),
[starting](../../packages/core/src/remote/call-start.ts),
[waiting](../../packages/core/src/remote/call-wait.ts),
[talking](../../packages/core/src/remote/call-talk.ts),
[tests](../../packages/core/test/calls.test.ts)). On 2026-11-03, with
`tool.shell` workflows in separate processes and projects: outputs across
projects, `wait: none`, a refusal handled by a `when` edge, a ring of files
stopped by the depth limit, a hub of `control.split` and `control.join`, a
timeout, a stop that reached the called run, resuming after that stop and after
a `kill -9` of the caller, and a failed called run retried by resuming its
caller. With real sessions, for $0.036: two sessions in two repositories talking
over a channel by name, a conversation resuming an ended session with both costs
counted, a cap ending a session, `ref` starting a worktree from a branch, and a
stop ending a resumed session within a second. A guide:
[Working across projects](../../docs/guides/working-across-projects.md).

A `workflow.call` node starts a workflow as a separate run, in this project or
another registered one, under that project's own rules, agents and worktrees. It
holds no session and no worktree.

- **Starting.** Each activation starts `ork run` in the background
  (`detachRun`), with `inputs` rendered from the caller. A run that refuses to
  start, such as on a dirty tree, fails the node with the reason, and so does a
  project that is not registered, a missing workflow, or a project whose
  [`calls.accept`](../project-rules.md#calls) leaves this one out, or a rendered
  name that is not a plain file name. The called run's record names its `parent`
  and `depth`, and `run.started` names its caller. Calls may nest 5 deep, since
  files can call each other in a circle.
- **`ref`** is what the called run's worktrees start from, instead of its
  project's `HEAD`.
- **Waiting.** `wait: run`, the default without `node`, finishes when the run
  has ended; `wait: node`, the default with `node`, when that node has reported;
  `wait: none` once the run has started. A waiting call follows the run's events
  over its socket, falling back to the store.
- **Output.** For `wait: run`: `status` (`pass` or `fail`), `summary`, `run`,
  `runStatus` and `outputs`, the workflow's [`outputs`](../workflow-format.md)
  rendered when it ended. For `wait: node`: that node's report and `run`. For
  `wait: none`: `status`, `summary` and `run`. The node fails when the run did
  not succeed, or the report's status is `fail`.
- **Activating again.** Without `node`, each activation is a new run, so they
  can run in parallel. With `node`, the call keeps one run as a conversation,
  and its activations take turns. A later activation's input reaches the node as
  a message if its session is live, and `wait` applies as for the first. If the
  node has reported, its session is resumed with the input once its run has
  ended, in the caller's process, and the report comes back
  ([L60](./calls-limits.md)).
- **Talking.** A [`messages` channel](../messaging/links.md#calls) may name a
  call that names a node.
- **One budget.** No call starts once the caller's budget is spent. The called
  run gets the lesser of its own `limits.budgetUsd` and what the caller had left
  when it started, as `--budget-cap`. What it spent comes back as the call's
  usage when the call finishes, and counts against the caller. See
  [L53](./calls-limits.md).
- **Stopping.** A stop or an expired run timeout on the caller stops every run
  it called and is still running, as does a stop or timeout on the node. Links
  are ended, but runs joined only with `ork relay` are left alone. Pause does
  not spread ([L56](./calls-limits.md)).
- **Resuming.** A node's result names its run, and `call.started` records each
  run a call started. `ork resume` keeps a node's successful results up to its
  first failure, so those runs are closed and the rest are open. An activation
  takes the oldest open run instead of starting another. If that run stopped,
  crashed or failed it is resumed too, with its finished nodes, cap, caller and
  `ref`; if it is running or succeeded, it is attached to and its latest go is
  read. A called run that was resumed repeats no events for what it kept, so a
  `wait: node` call first looks for a report already stored. A conversation
  between activations has its run brought back the same way and its links made
  again, since they ended with the caller; what its results already counted is
  not counted twice.
