# RFC-004 — Workflows that call workflows

- **Status:** Accepted
- **Date:** 2026-11-03
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions)

## Context

A workflow engine needs workflows to compose. GitHub has reusable workflows
(`uses`, `with`, `outputs`), GitLab has `trigger` with `strategy: depend`, n8n
has a sub-workflow node with a choice to wait for it, and Temporal has child
workflows with a policy for what happens when the parent closes. Ork has none of
this: a workflow file is the largest unit, and one workflow cannot start another
or use its result.

The need is concrete. A change in `se-backend` usually needs work in
`se-client-kit`, and a project's process often has a piece worth sharing between
its workflows, such as a review.

What Ork has now, checked on 2026-11-03:

- **Fan-in and conditions already work.** A graph of
  `node1, node2, node3 -> relayer -> client-kit-relay` with `when` conditions,
  run with shell nodes standing in for the last one: with two edges taken,
  `relayer` and the node after it ran twice, once per edge; through a
  `control.join` the next node ran once; with none taken, all of it was skipped.
- **Starting a run from another process exists.** The local server starts one in
  any registered project with `detachRun`
  ([write-routes.ts](../../packages/server/src/write-routes.ts)), after finding
  the workflow in that project's folder.
- **Following one exists.** `followEvents` reads a run's events over its socket,
  or from the store without one
  ([follow.ts](../../packages/core/src/remote/follow.ts)).
- **A workflow has inputs but no outputs**
  ([workflow.ts](../../packages/schema/src/workflow.ts)). A caller could see
  only that a run ended, and how.
- **Budgets are per run**, and nothing caps runs together
  ([L39](../../specs/gaps/limits.md)).

## Options

### Option A — A node that calls a workflow, as its own run

A new node type. On activation it starts the named workflow as a separate run,
in this project or another, and optionally waits for it.

- **Pros:** Edges, `when`, `maxRounds`, joins and routers apply unchanged,
  because it is a node like any other. The called workflow runs under its own
  project's rules, agents, worktrees and context, so nothing in those parts
  changes. It needs no new format for the called workflow beyond optional
  outputs. Each run keeps its own logs and can be stopped, resumed and inspected
  alone.
- **Cons:** A tree of runs needs its budget, stop and view worked out across
  runs. Its decisions arrive from a separate run.

### Option B — Inline the called workflow at compile time

Expand the called workflow's nodes into the caller's graph, as GitHub's
composite actions do.

- **Pros:** One run, one graph, one budget, and one place for its decisions.
- **Cons:** Cannot cross projects, because a run has one root and an owner
  cannot merge across repositories
  ([ADR-018](../../decisions/ADR-018-ork-merges-children.md)), and that is the
  need that started this. Node ids must be namespaced, and rules from two files
  must be merged.

### Option C — One node in another project

A node takes `project: se-client-kit` inside one run.

- **Pros:** One graph and one budget.
- **Cons:** Cuts across worktrees, rules, context layers, claims, resume and the
  run record's single project, with the same merge problem as Option B. A second
  workflow's structure could not be reused at all.

### Option D — A shell node that runs `ork run`

No engine change: `tool.shell` with `ork run other`.

- **Pros:** Works today, for a child in the same project or, with `cwd`,
  another.
- **Cons:** No structured output, no shared budget or stop, and a detached child
  gives a caller nothing to wait on. The child is invisible in the graph.

## Decision

**Option A**, as the maintainer's choices on 2026-11-03 add up to: a new node
type, `workflow.call`. The maintainer first chose this shape under the name
`relay.peer`, then widened it: starting another workflow and waiting on its
output is worth having on its own, with talking during the work as an addition
from [RFC-003](./RFC-003-relay-between-runs.md).

```yaml
outputs:
  summary: "{{nodes.builder.output.summary}}"
nodes:
  relayer: { type: control.split } # or control.join for one combined handoff
  client-kit:
    type: workflow.call
    project: se-client-kit # a registered project's id; default this project
    workflow: feature
    node: builder # optional: the node to talk to and wait on
    inputs: { feature: "{{inputs.feature}}" }
edges:
  - { from: [node1, node2, node3], to: relayer, when: "needs_client_change" }
  - relayer -> client-kit
  - { from: client-kit, to: merge, when: "status != 'fail'" }
messages:
  - between: [builder, client-kit]
```

- **One new type.** A hub such as `relayer` is an existing control node:
  `control.split` or `control.router` activate the call once per edge taken, and
  `control.join` once with the results combined. Direct edges work too.
- **Starting.** An activation starts the workflow as a separate, detached run
  with `inputs` rendered from the caller. A call with no incoming edges starts
  with the run, which gives parallel work across projects from one `ork run`.
  The target project's own rules, agents and worktrees apply. A refusal, such as
  a dirty tree, fails the node with the reason, and a `when` edge can handle it.
- **Waiting.** `wait` decides when the node finishes, so when its edges are
  decided:
  - `run`: the called run has ended. The default without `node`.
  - `node`: the named node has reported. The default with `node`.
  - `none`: as soon as the run has started.

  A waiting call holds no Claude session and follows the run's events over its
  socket, falling back to the store.

- **Output.** `status`, `run`, and the run's `outputs` for `wait: run`, or the
  node's report for `wait: node`. The node succeeds when the called run
  succeeded or the report's status is not `fail`.
- **Workflow outputs.** A workflow may declare `outputs:`, a map of templates
  over its nodes, rendered when the run ends. It is optional and additive, so
  `schemaVersion` stays 1.
- **Activating again.** Without `node`, each activation is a new run, so calls
  can run in parallel and repeat freely. With `node`, the call keeps one run as
  a conversation: activations are handled one at a time, in order, each input
  arriving as a message. If that node's session has ended, it is resumed with
  the input, as a re-entered leader is, and `maxRounds` bounds the cost. Unlike
  an agent's `send_message`, this is allowed because the workflow file asked for
  it.
- **Talking.** A `messages` channel may name a call with `node`, so agents write
  to `client-kit` by name with no run ids. Starting the call makes the link
  ([RFC-003](./RFC-003-relay-between-runs.md)), and the called workflow needs no
  changes. A message sent before the call has started waits for it.
  `maxMessages` on the node sets the link's limit.
- **Where a project comes from.** `project` is a registered id, so the file
  holds no path and a teammate who registers the same id can run it.
  `ork validate` warns when the project is not registered here, since that may
  only mean another machine, and checks the workflow, the node and required
  inputs when it is. A run refuses, naming `ork register`.
- **Which ref.** An optional `ref` is what the called run's worktrees start
  from, for example `"{{nodes.build.output.branch}}"`, so a shared review can
  look at the caller's work.
- **Compile checks.** A call has no `parent` for now, so a leader cannot
  `delegate` to one. A call to its own workflow is refused. A chain across files
  is caught at run time by a depth limit, since the compiler sees one file.
- **One budget.** A called run gets the lesser of its own `limits.budgetUsd` and
  what the caller has left, and its cost counts against the caller, so a tree of
  runs has one cap. Runs joined with `ork link` keep their own.
- **Stopping.** `ork stop` on a caller stops the runs it called, since a user
  who stops a run expects spending to stop. Runs joined with `ork link` are left
  alone. Pause does not spread at first.
- **Who may call.** Any registered project, by default. A rule in the target's
  `project.yaml` can limit it, and the called run's events name the caller.
- **Timeout.** A call takes `timeout` as a tool node does
  ([ADR-043](../../decisions/ADR-043-timeouts.md)). An expired call stops the
  run it started.
- **Resume.** `workflow.called` in the caller's events records the called run's
  id. `ork resume` reattaches, or reads the result if the run has ended.

## Consequences

**Positive**

- One `ork run` can bring up work across repositories, and later steps can
  branch on its results.
- Shared pieces of process live in one file and are called with inputs.
- `tool.git`, gates and loops all compose with it, since it is a node.

**Negative**

- A called run in the background has no terminal, so its questions wait in
  `ork decide` or the UI's inbox, even when the caller runs in a terminal.
- Runs are heavier than inlined nodes: each is a process with its own worktrees.
- Concurrency stays per run, unlike the budget, so a tree of runs can hold more
  sessions than any one limit says ([L39](../../specs/gaps/limits.md)).
- Calling across projects depends on what is registered on the machine, as a
  tool node depends on what is installed.

**Follow-up work**

- Schema: `workflow.call`, `outputs`, and `maxMessages`; regenerate the JSON
  Schema. Compiler: the checks above and channels that may end at a call.
- Core and nodes: the executor. Starting a run belongs to the CLI and the
  server, so it reaches the executor as a port, as `Workspace` and
  `HumanChannel` do, and the package direction stays intact.
- Store: a run's parent, so runs form a tree, and its depth.
- UI: the Monitor shows a call as a node that opens the called run. The
  Designer's palette gets it.
- Specs: [workflow format](../../specs/workflow-format.md),
  [graph compiler](../../specs/graph-compiler.md),
  [scheduler](../../specs/scheduler.md),
  [event store](../../specs/event-store.md). A guide and an example. An ADR on
  shipping.
- Prove it on real runs across two repositories, on both drivers.

## Open questions

None for the maintainer. They were answered on 2026-11-03 and are in the
[Decision](#decision). The limit on how deep calls may nest, and the rule's
exact name in `project.yaml`, are left to the build.
