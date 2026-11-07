# RFC-013 — Running a node once per item of a list

- **Status:** Accepted (2026-11-07)
- **Date:** 2026-11-07
- **Decided:** by the maintainer on 2026-11-07, and accepted the same day
  ([Decisions](#decisions))
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
  - [What Ork has now](#what-ork-has-now)
  - [Prior art](#prior-art)
  - [What the design must keep](#what-the-design-must-keep)
- [Options](#options)
- [Choices weighed inside Option A](#choices-weighed-inside-option-a)
- [Decision](#decision)
- [Consequences](#consequences)
- [Decisions](#decisions)
- [Open questions](#open-questions)

## Context

The M2 roadmap item `for-each`
([roadmap.js](../../docs/interaction-map/public/js/data/roadmap.js)) asks for
"running a node for each item of a list from the workflow file, as `matrix` does
elsewhere, rather than leaving it to a leader's `spawn_worker`", after workflow
calls. Calls shipped
([ADR-045](../../decisions/ADR-045-workflows-calling-workflows.md)), so a
fan-out can now reach whole pipelines, not only single nodes.

The need is the same shape each time: lint each package, review each changed
module, run one worker per task a planner wrote, call a workflow once per
repository, or comment on each open pull request. The number of items is known
only from the file, or only once an earlier node has run.

### What Ork has now

Checked against the code on 2026-11-07:

- **A fixed fan-out is drawn by hand.** `control.split` passes its input along
  every outgoing edge, a node runs once per taken edge, and `control.join`
  gathers `statuses`, `results` (keyed by the source node's id) and `count`
  ([routing.ts](../../packages/core/src/run/routing.ts), `joinOutput`;
  [scheduler](../../specs/scheduler.md#control-nodes)). Three packages are three
  declared nodes. A list whose length isn't in the file can't be drawn.
- **A dynamic fan-out is a model's choice.** A leader's `spawn_worker` runs
  instances of a child worker, `<template>-2`, `-3`, …, up to `maxWorkers`
  (default 0) ([delegation](../../specs/scheduler.md#delegation)). The leader
  writes each brief and reads each report in its own context, only Claude
  workers can be spawned, and a walk doesn't cover delegation
  ([walking](../../specs/scheduler/walking.md#limits)).
- **Instances already exist.** An `Activation` carries `template`, "the declared
  node it is an instance of"
  ([handle.ts](../../packages/core/src/run/handle.ts)). The usage ledger records
  a spawned worker's template and groups its sessions under it
  ([usage](../../specs/usage.md#the-ledger)), `ork tree` lists instances under
  their leader ([event store](../../specs/event-store.md)), and pausing a node
  pauses its instances ([run control](../../specs/run-control.md#pause)).
- **Instance ids can collide with declared ones.** `nextInstance` skips any id
  the graph already declares
  ([delegation.ts](../../packages/core/src/run/delegation.ts)), so an instance's
  name depends on what else the file holds.
- **Run state is kept per node id.** `outputs`, `rounds`, `sessionIds` and holds
  are maps by id ([scheduler.ts](../../packages/core/src/run/scheduler.ts)), and
  resume hands back each id's results in the order they were recorded, up to its
  first failure ([resume.ts](../../packages/core/src/run/resume.ts),
  `createReplay`). Two activations of one id that finish in either order could
  not be told apart on resume, so items need ids of their own.
- **A declared output can't say "a list".** A tool's or MCP call's
  `output.schema` takes a list of values or `string`, `number`, `integer`,
  `boolean` ([settings.ts](../../packages/schema/src/settings.ts),
  `DeclaredOutputSchema`), and the run checks only those
  ([declared.ts](../../packages/core/src/run/declared.ts)). A Claude node may
  write a field as raw JSON Schema, which only the driver enforces
  ([report.ts](../../packages/core/src/runtime/report.ts)). Workflow inputs are
  `string`, `number` or `boolean`
  ([workflow.ts](../../packages/schema/src/workflow.ts)).
- **Templates render text.** `{{ }}` renders objects as JSON
  ([expressions](../../specs/expressions.md#semantics)); only a `when:` is
  evaluated to a value. A list can't pass through a template as a list today.
- **Concurrency caps sessions only.** `limits.concurrency` (default 4) caps
  Claude sessions; tool nodes, MCP calls and calls are not limited
  ([scheduler](../../specs/scheduler.md#budget-and-concurrency)), and the cap is
  per run (L39 in [gaps](../../specs/gaps.md)).
- **What a session sees.** A node's `instructions` are rendered into its system
  prompt and its `prompt` is the task, last
  ([brief.ts](../../packages/core/src/run/brief.ts)), in the cache-friendly
  order of [context](../../specs/context.md#how-a-nodes-session-is-compiled). A
  worker's first round gets no copy of its input: only a re-entry appends
  `## Round n` with it ([claude.ts](../../packages/nodes/src/claude.ts),
  `reentryNote`).
- **Types opt into fields.** `notify:` and `before:`/`verify:` are field groups
  (`notifyFields`, `stepFields`) spread into the node schemas that accept them,
  each a strict object ([nodes.ts](../../packages/schema/src/nodes.ts)). The
  builder's inspector is drawn from the JSON Schema, so a new field needs no
  form code
  ([builder](../../specs/ui/panels-builder-logs-and-decisions.md#builder)).

### Prior art

- **GitHub Actions `strategy.matrix`** lists values in the file, or builds them
  at run time from an earlier job's output with `fromJSON`. Keys multiply into
  combinations. `max-parallel` caps how many run, and `fail-fast`, on by
  default, cancels the rest when one fails. A matrix job has one set of outputs,
  so its combinations can't each hand a value on without a workaround such as
  artifacts.
- **Argo Workflows** has `withItems` (a list in the template) and `withParam` (a
  JSON list, usually an earlier step's output), read as `{{item}}` and
  `{{item.field}}`. `parallelism` caps how many run, and a fanned-out step's
  output parameters gather into a JSON list for the steps after it.
- **Airflow dynamic task mapping** calls `.expand()` over a literal list or an
  upstream task's result, resolved at run time, with `.partial()` for the fixed
  arguments. Each mapped instance has a `map_index`, the next task receives the
  results as a sequence in that order, an empty list skips the mapped task, and
  a setting caps how long a list may be. One failed instance doesn't stop the
  others; the next task's trigger rule decides.
- **Ork's `spawn_worker`** is the model's choice: the leader decides how many
  and what each does. That is right when splitting the work takes judgment, and
  costly when the list is already known.

What they share: the engine resolves the list, the items run as instances of one
declared step, a later step reads the results in item order, and both the length
and the parallelism have caps. They differ on what one failure does.

### What the design must keep

- **Deterministic first.** Fanning out and gathering are bookkeeping; no model
  turn should be spent on them.
- **Token economy.** Each item's session should carry its own item and nothing
  of its siblings, and share a cacheable prefix with them.
- **Prevention over detection.** A fan-out with no bound, with no gather, or
  over something that isn't a list should be impossible to write where it can
  be, and an error where it can't.
- **Registries, not branches.** No `if (type === …)` for fan-out in shared code.
- **Mechanism, not policy.** Concurrency, failure handling, merging and branch
  names are the project's to set, with defaults.
- **The engine's invariants.** Bounded work, events that replay, resume that
  hands back what finished, and both drivers.

## Options

### Option A — `forEach:` on a node

A field on the node types that accept it. The node's activation resolves a list,
runs one **item** (an instance of the node) per entry, and finishes once, with
the items' results gathered.

- **Pros:** One key on a node already drawn. Edges, `when:`, joins, loops, gates
  and timeouts apply unchanged, because the node finishes once. It reuses the
  instance machinery (`template`, the ledger's grouping, pause). On a
  `workflow.call` it gives a whole pipeline per item, so Options B and C come
  with it. A strict schema refuses it on types that can't fan out, and the
  inspector gets its form from the JSON Schema.
- **Cons:** The scheduler gains a fan-out and a gather inside one activation. A
  fanned node reports the gathered fields, not its type's, so the compiler,
  `nodeSays` and the builder's pickers must know that. An item can't continue
  down its own path of several nodes without a call.

### Option B — A `control.map` node wrapping a subgraph

A container node holding a small graph, run once per item, as AWS Step
Functions' Map state or an Argo template does.

- **Pros:** A several-step pipeline per item, in one run, in one file.
- **Cons:** The format has no nesting: `nodes` is one flat map, with `parent`
  for ownership only ([workflow.ts](../../packages/schema/src/workflow.ts)). A
  subgraph needs namespaced ids, edges across its boundary, nested walking,
  per-item worktrees and replay keys for every inner node, and a graph layout
  that is no longer a pure function of a flat graph
  ([graph](../../specs/ui/graph.md#layout)). `forEach` on a `workflow.call`
  gives most of this, with the called file as the subgraph.

### Option C — A `map` node over workflow calls only

Each item is a full sub-run: a node type that calls a named workflow once per
item.

- **Pros:** Everything a call has, per item: its own process, logs, worktrees,
  resume and stop, across projects.
- **Cons:** A process and a run per item, heavy for one `gh` command or one
  review. A second type duplicates `workflow.call`'s fields. Fanning out one
  tool or worker would need a second file. Under Option A it is `forEach` on a
  `workflow.call`.

### Option D — A pair of control nodes

A `control.each` that activates what follows it once per item, and a gather (the
existing `control.join` or a new one) where they meet again.

- **Pros:** Fits "control nodes route", and lets several nodes run per item
  between the two.
- **Cons:** A split without its gather, or a gather in the wrong place, can be
  written: a malformed fan-out by construction. Every node between the two must
  run per item, which is Option B without the boundary. A join gathers by edge,
  not by item.

### Option E — Leave it to `spawn_worker`, or to a script

No engine change.

- **Pros:** Nothing to build. The model judges how to split the work.
- **Cons:** Model turns on bookkeeping, and every report lands in the leader's
  context, so its tokens grow with the items. Only Claude workers, bounded only
  by `maxWorkers`, and unseen by a walk. A loop inside a `tool.shell` script has
  no per-item view, resume, worktree or parallel session slot.

## Choices weighed inside Option A

Each of these is a smaller call under Option A. The first answer is the one the
maintainer chose ([Decisions](#decisions)); the rest are kept as the record of
what was weighed.

1. **Where the list comes from.** Both a static list in the file and a list an
   earlier node reports, as one field with two shapes, chosen. Static only loses
   the planner case; dynamic only makes a fixed list a tool node.
2. **How a dynamic list is named.** A template that is exactly one path,
   `from: "{{nodes.plan.output.tasks}}"`, evaluated to a value, chosen: it reads
   like every other reference in the format, and the builder writes it from a
   picker. A structured `{ node: plan, field: tasks }` prevents more for
   hand-written files, but is a second way of naming an output. A bare
   expression (`nodes.plan.output.tasks`, as a `when:` is) is a third.
3. **Which item is which.** By index, chosen, as Airflow's `map_index`. An
   optional `key:` expression (`{{item.name}}`) would keep an item's worktree
   and session with the same item when a list changes between rounds; it can
   come later without breaking index ids.
4. **An item's id.** `build.0`, `build.1`, counted from 0, chosen. A declared id
   can't contain `.` ([settings.ts](../../packages/schema/src/settings.ts),
   `NodeIdSchema`), so an item can't collide with a node; it is a valid branch
   component and folder name, and needs no quoting in a shell. `build-0` can
   collide, as spawned workers do. `build[0]` is a glob in zsh and bash, so
   `ork logs --node build[0]` fails unquoted.
5. **How results gather.** Arrays in item order, under the names a join uses,
   chosen: `statuses`, `results`, `count`, plus `items`, the list itself. So
   `any(statuses, 'fail')` reads the same on a join and on a fanned node. A map
   keyed by item would need a key for every item.
6. **What one failure does.** `onFailure: finish`, the default chosen: every
   item runs, and the node fails afterwards if any did. Items are usually
   independent, and resume runs only the failed ones again. `onFailure: stop`
   starts no more items once one fails; those running finish their turn, as a
   pause never cuts one short. Aborting running items is left out: it cuts a
   turn, and `ork stop --node` does that by hand.
7. **How many at once.** `maxParallel`, defaulting to the run's
   `limits.concurrency`, for every node type, chosen, so tools and calls are
   bounded too, which nothing else bounds. Claude items also take the run's
   session slots. Weighed: no default cap for non-session items (as today), or a
   required value.
8. **A list with no items.** The node succeeds with `count: 0`, chosen, so
   `when: count > 0` routes around it. Skipping it, as Airflow does, makes
   "nothing to do" unrouteable, since a skipped node takes no edge.
9. **A list longer than its cap.** Asked, as a loop out of rounds is: **stop**
   (the answer when no one is there), **run the first `maxItems`**, or **run
   all**. Chosen. Failing outright gives no way on; cutting it silently loses
   work unseen.
10. **What an item reads.** `{{item}}` and `{{index}}` in the node's own
    templates, chosen, plus `ORK_ITEM` and `ORK_INDEX` for a program, since
    `script:` takes no templates. Not in `instructions`, `context` or `skills`,
    so items share one system prompt.

## Decision

**Option A**, with the choices above, as the maintainer decided on 2026-11-07
([Decisions](#decisions)).

```yaml
nodes:
  plan:
    type: claude.worker
    prompt: Split {{inputs.feature}} into independent tasks.
    output:
      schema:
        tasks: { list: { title: string } } # new shape; `{ list: {} }` for no item shape
  build:
    type: claude.worker
    isolation: worktree
    forEach:
      from: "{{nodes.plan.output.tasks}}"
      maxItems: 8 # required with `from`
      maxParallel: 3 # default: limits.concurrency
      onFailure: finish # or stop
    prompt: "Do this task, and only it: {{item.title}}"
  lint:
    type: tool.shell
    forEach:
      items: [api, web, worker] # a static list; no cap needed
    command: pnpm --filter {{item}} lint
edges:
  - plan -> build
  - build -> review # taken when every item succeeded
  - { from: build, to: triage, when: "count(statuses, 'fail') > 0" }
```

### The format

- **`forEach`** takes either `items` (a list in the file, at least one entry) or
  `from` with `maxItems`; the schema is a union of those two shapes, so a
  dynamic list without a cap can't be written. `maxParallel` and `onFailure` are
  optional in both.
- **Who takes it:** `claude.worker`, every `tool.<id>`, `mcp.call` and
  `workflow.call`, as a field group spread into their schemas, as `notifyFields`
  is. Control nodes and `claude.subagent` (which runs inside its parent's
  session) don't have the key, so a strict schema refuses it. Nor do
  `claude.leader`, whose children would then belong to each item, and
  `human.gate`, which would ask a person once per item.
- **A declared list** joins `string`, `number`, `integer` and `boolean` in
  `output.schema`, for tools, MCP calls and Claude nodes, written
  `{ list: { <field>: <rule>, … } }`: an optional item shape whose fields take
  the rules a top-level field takes, or `{ list: {} }` for none. The run holds a
  node to it, items included
  ([declared.ts](../../packages/core/src/run/declared.ts)), and
  `reportSchemaFor` turns it into JSON Schema `type: array` with `items`, so a
  Claude planner's list is checked by Ork on both drivers, not left to one.
  `{{item.<field>}}` is checked against the shape when there is one, and against
  the file's entries for a static `items:` list.

### Running it

- **The fanned node's activation** resolves the list, records it, and starts
  items `build.0` … `build.n-1`, up to `maxParallel` at a time. The scheduler
  reads only `forEach`, never the node's type, and each item runs through the
  type's own executor with `item` and `index` in its scope. An executor added
  through the registry fans out with no change.
- **An item** is an `Activation` with `template` set to the declared node, so it
  works like that node: same settings, its own session, its own worktree if the
  node has one, and its own `timeout`. A Claude item takes a session slot and a
  budget check before it starts, and per-session quota checks apply
  ([usage](../../specs/usage.md#limits-across-runs)).
- **A non-list** where a list was expected fails the node, with a reason in the
  words of a declared field: `tasks is "fix it", expected a list`.
- **The node's output** is `items`, `results` (in item order, each entry the
  item's declared output fields, its `summary`, and Ork's own `branch` and
  `worktree` when it has them; the full output stays in the item's own
  `node.finished` and logs), so `{{nodes.build.output.results}}` is enough for a
  later node to merge or review the items' branches, `statuses` (each item's
  `status`, or `pass`/`fail` from how a tool item ended, or `skipped` for one
  never started) and `count`. Its `ok` holds when every item succeeded. A plain
  edge out of it needs that; a `when:` reads the gathered fields.
- **Limits.** Budget or quota spent stops new items, and the run ends as it does
  today; resume goes on with the rest. `ork stop --node build` stops the running
  items and the node fails through the existing rules; `--node build.2` stops
  one item, and `onFailure` decides the rest. Pausing the node pauses its items,
  as for spawned workers.
- **Loops.** A fanned node in a loop resolves its list again each round and
  reruns every item, as a loop reruns any node; item `build.i` in round two is
  round two of that id, and `session: resume` resumes its session. Rerunning
  only the failed items may come later as an opt-in field.

### Worktrees, ownership and names

- **Each item's worktree** is named by the project's rules with `{node}` as the
  item's id: `ork/<run>/build.2` by default
  ([project rules](../../specs/project-rules.md)). The existing check that
  `branch` and `worktrees` name `{node}` when a run can have more than one
  worktree counts a fanned worktree node.
- **A fanned root node's** passing items keep their branches for the user, as
  root nodes do ([ADR-018](../../decisions/ADR-018-ork-merges-children.md)).
  Combining them is a later node's job, such as a leader or a `tool.git` step.
- **A fanned node with a `parent`** has its passing items merged into the
  owner's worktree one at a time, the existing rule
  ([worktrees](../../specs/worktrees.md#after-a-node)). It runs from its edges
  only: a leader's `delegate` to it is refused with that reason.

### Messages and rules

- **`notify:`** on a fanned node fires once, when the node finishes, and reads
  the gathered output and `ok`, as for any node. Its items fire none.
- **A `messages` channel** that names a fanned node is a compile error: a link
  joins one node, and the items don't exist until the list is resolved. This is
  recorded as a gap, beside L49 for spawned workers.

### Events

- `node.started` and `node.finished` for `build` bracket the whole fan-out, with
  the gathered output, so every view that reads them today sees one node.
- **`each.listed`** (new): the node, round, count and list, once resolved. The
  list holds nothing that isn't already in the run's events or the file.
- An item's `node.started` carries `item: { of, index }`, as a delegated run's
  carries `owner`; its `node.event` and `node.finished` are as for any node.
- **`each.exceeded`** (new): a list over `maxItems`, followed by the decision or
  owner-question events a loop out of rounds has.

### Resuming

- A fanned node whose `node.finished` succeeded is handed back whole; its items
  neither run nor replay.
- Otherwise it fans out again. The list is the recorded `each.listed` of that
  round when its source was handed back, so an edited file or a re-sorted list
  can't move results between items, and a new list when the source ran anew.
- Each item id has its own history, so finished items are handed back and the
  failed or unfinished ones run; one cut off mid-session continues it, by the
  `cutOff` rule that already works per id.
- Answers to `each.exceeded` are given again in order, as loop answers are.
- Runs from before have none of these events or fields, and resume unchanged.

### Checking and walking

- **`ork validate`** errors when `from` isn't exactly one path, reads a field
  its source declares as something other than a list, or reads a node that can't
  have run before it; when `{{item}}` or `{{index}}` appears outside a fanned
  node, or in its `instructions`, `context` or `skills`; and when a later node
  reads a field a fanned node doesn't gather. A source with no declared shape (a
  call's outputs, a split's passthrough) warns, as `ref.undeclared` does.
  `loop.uncapped`'s count multiplies by `maxItems` or the list's length.
- **A walk** treats a fanned node as one node whose outcomes are the gathered
  ones: every item succeeded; one failed (with the rest succeeded for `finish`,
  skipped for `stop`); for `from`, also an empty list, and a list over
  `maxItems` with each answer. `statuses` and `count` vary with what conditions
  read, from the item type's own list of what it says.

### What people see

- **The Monitor's graph** keeps one card per declared node, with its items'
  progress as its status ("3 of 8, 1 failed"), so the drawing stays the file's
  shape. The node table and `ork tree` list items under it, as spawned workers
  are listed under their leader, each with state, time and cost.
- **The builder** draws the `forEach` group from the JSON Schema; `from` is a
  dropdown of the `list` fields the nodes before it declare, as conditions are
  picked
  ([ADR-052](../../decisions/ADR-052-conditions-from-declared-outputs.md));
  `{{item}}` is offered only in a fanned node.
- **Usage** groups items' sessions under their node, as spawned workers group
  under their template; `ork logs --node build` keeps the node and its items.

### Both drivers

Fanning out and gathering are the scheduler's, before any session starts, so
neither driver changes: each item's session is an ordinary one. The `list` shape
reaches a Claude session through `reportSchemaFor` on both, and Ork checks it
itself. Tests run on the fake runtime.

### How each item's context stays small

- An item's session reads its item only where its prompt says `{{item}}`; it
  gets neither the list nor its siblings' results, and a first round adds no
  copy of its input.
- `{{item}}` is refused in `instructions`, `context` and `skills`, so every item
  has the same system prompt, the shared prefix the context compiler orders for
  caching. Whether sessions started together actually share the cache is not
  measured ([open questions](#open-questions)).
- No leader turns are spent writing briefs or reading reports, as they are with
  `spawn_worker`.
- A later node pays for `results` only if its prompt reads them, and then only
  for each item's declared fields, summary, branch and worktree; a `when:` on
  `statuses` or `count` costs nothing.

## Consequences

**Positive**

- A known list fans out with no model turn, visibly, with per-item resume.
- A whole pipeline per item, across projects, is `forEach` on a `workflow.call`.
- `spawn_worker` stays for what needs judgment.

**Negative**

- A fanned node has two output shapes (its items' and the gathered one), which
  the compiler, the pickers and readers of the format must keep apart.
- Items can't follow their own path of several nodes without a call, and a call
  per item is a process per item.
- `maxParallel` on a call caps runs, not their sessions: each called run has its
  own `limits.concurrency`, so the per-run cap (L39) multiplies.
- An item's identity is its index: a list that changes between rounds hands item
  `i`'s worktree and session to whatever is `i` now.

**Follow-up work**

- Schema: the `forEach` field group, the `list` shape; regenerate the JSON
  Schemas. Core: the fan-out and gather, item ids, `each.listed`,
  `each.exceeded`, resume, the compiler checks, `nodeSays` for gathered fields,
  the walk. Nodes: `ORK_ITEM`, `ORK_INDEX`. UI: the card's progress, item rows,
  the `from` picker.
- Specs: [workflow format](../../specs/workflow-format.md),
  [scheduler](../../specs/scheduler.md),
  [resuming and events](../../specs/scheduler/resuming-and-events.md),
  [walking](../../specs/scheduler/walking.md),
  [expressions](../../specs/expressions.md),
  [graph compiler](../../specs/graph-compiler.md),
  [worktrees](../../specs/worktrees.md), [usage](../../specs/usage.md), the
  Monitor and builder pages, and the interaction map. A guide and an example. An
  ADR on shipping.
- Gaps to record: a `messages` channel can't name a fanned node (decision 13,
  beside L49 for spawned workers), and whatever of
  [open questions](#open-questions) ships simpler.

## Decisions

The maintainer decided each of these on 2026-11-07, 1 to 13 as recommended, then
14 to 16 from the open questions, and accepted the RFC; 17 followed the same
day. The options that lost are kept in [Options](#options) and
[Choices weighed inside Option A](#choices-weighed-inside-option-a).

1. **The shape:** `forEach:` on a node (Option A). Not a `control.map` subgraph,
   a map over calls only, a pair of control nodes, or no change.
2. **Where a list comes from:** a static `items:` list, or `from:` an earlier
   node's output, which requires `maxItems`.
3. **How `from` names it:** a template that is exactly one path,
   `"{{nodes.plan.output.tasks}}"`.
4. **What one failed item does, by default:** `onFailure: finish`, every item
   runs; `stop` is the other value.
5. **`maxParallel` by default:** the run's `limits.concurrency`, for every node
   type.
6. **An empty list:** the node succeeds with `count: 0`.
7. **A list over `maxItems`:** the run asks, as for a loop out of rounds.
8. **Item ids:** `build.0`, `build.1`, ….
9. **Index base:** 0, as the ids are, and as `results[0]` is.
10. **Which types take `forEach`:** `claude.worker`, every `tool.<id>`,
    `mcp.call` and `workflow.call`.
11. **A fanned node with a `parent`:** allowed. It runs from its edges only, its
    passing items merge into the owner, and a `delegate` to it is refused.
12. **`notify:` on a fanned node:** fires once, when the node finishes.
13. **A `messages` channel naming a fanned node:** refused, and recorded as a
    gap.
14. **Gathered `results`:** each entry holds the item's declared output fields
    and its summary only. The full output stays in the item's own record and
    logs.
15. **Loop rounds:** a round reruns every item, as a loop reruns any node.
    Rerunning only the failed items can be a later opt-in field.
16. **The list shape:** `tasks: { list: { title: string, … } }`, with an
    optional item shape (`{ list: {} }` when there is none). `{{item.<field>}}`
    is checked when a shape is declared.
17. **Branches in `results`:** each entry also carries the item's `branch` and
    `worktree`. They are Ork's own facts, not model output, so
    `{{nodes.build.output.results}}` is enough for a later node to merge or
    review the items' branches. This widens decision 14.

## Open questions

Still open. Three that were here are answered by decisions 14 to 16: whether a
round reruns only failed items, whether lists declare an item shape, and whether
gathered results are trimmed.

- **Does the shared prefix pay off?** Items started together have the same
  system prompt, but whether parallel sessions hit the prompt cache, and what
  that saves, is unmeasured; the roadmap's `benchmark` item is where to find
  out.
- **List inputs.** Should workflow inputs take a `list` type, so
  `ork run --input` and a caller's `inputs` can hand a list in, and in what
  syntax?
- **Several lists.** GitHub multiplies matrix keys into combinations. Is a
  product of lists wanted, or is a tool node that computes one enough?
- **A per-fan-out budget.** Each session gets the node's `budgetUsd` and the
  run's cap holds, but is a cap on all of one node's items wanted?
- **The walk on long static lists.** Whether treating a fanned node as one keeps
  a walk within its 4,096 paths and one second on real files needs trying on the
  examples.
- **`ork run --node build`** on a node whose list comes `from` another: fail
  with a reason, or take a list from `--input`?
