# Running a node once per item

_Part of [Writing workflows](../writing-workflows.md)._

`forEach` runs one node once for each entry of a list: a worker per task, a
program per file, a call per repository. Ork does the fanning out and the
gathering itself, so no model turn is spent on either. The whole example is
[examples/fan-out.ork.yaml](../../../examples/fan-out.ork.yaml).

## Contents

- [A list you write, or one a node reports](#a-list-you-write-or-one-a-node-reports)
- [Reading the item](#reading-the-item)
- [A model for each item](#a-model-for-each-item)
- [Pace and failure](#pace-and-failure)
- [What comes out](#what-comes-out)
- [A list that is too long](#a-list-that-is-too-long)
- [Worktrees](#worktrees)
- [Stopping, resuming and watching](#stopping-resuming-and-watching)

## A list you write, or one a node reports

A worker, a tool node, an `mcp.call` and a `workflow.call` take `forEach`. A
leader, a gate, a sub-agent and a control node don't; the schema refuses it.

```yaml
nodes:
  lint:
    type: tool.shell
    command: pnpm lint {{item}}
    forEach:
      items: [packages/core, packages/cli] # at least one entry
```

Or take the list from an earlier node, with a cap:

```yaml
nodes:
  plan:
    type: claude.worker
    prompt: "Split this goal into at most 6 independent tasks: {{inputs.goal}}"
    isolation: readonly
    output:
      schema:
        tasks:
          list: # declared, so the next node can be checked
            title: string
            detail: string
  build:
    type: claude.worker
    prompt: "Task {{index}}: {{item.title}}. {{item.detail}}"
    isolation: worktree
    forEach:
      from: "{{nodes.plan.output.tasks}}"
      maxItems: 6
edges:
  - plan -> build
```

- `from` is exactly one `{{ }}` path to a list, and `maxItems` is required
  beside it: every item can start a session, so the list needs a cap you chose.
- A field is a list when it is declared `{ list: … }` in `output.schema`. The
  shape beside it, `title: string`, takes the same rules as any other field;
  `list: {}` declares no shape. A tool's JSON is declared the same way, under
  `output: { format: json, schema }`, and read under `json`:
  `from: "{{nodes.plan.output.json.tasks}}"`. `ork validate` warns, naming that
  path, when `from` leaves out `json`.
- Something that isn't a list fails the node, saying so:
  ``tasks is `fix it`, expected a list``.
- The node reading the list has to come after the node reporting it.
  `ork validate` reports `from` reading a node that can't have run first, or a
  field declared as something other than a list. A list nothing declares is a
  warning: it runs, but a mistake in it is found only in the run.
- In the [browser Builder](../browser-view/panels-and-workspace.md#builder), a
  node's **For each** group does this with no YAML: **Run this node** picks
  once, once per item listed here, or once per item of a list from an earlier
  node; **List from** offers only the lists earlier nodes declare; **Most
  items** is the cap; **Add a list** declares one on an earlier node.

## Reading the item

`{{item}}` is the entry, `{{index}}` its place from 0. They work in `prompt`,
`command`, an `mcp.call`'s `arguments`, `inputs`, `env` and `ref`, and only in a
node with `forEach`. For an entry with fields, `{{item.title}}` reads one;
`ork validate` checks the name against the declared shape.

A program also gets them as environment variables: `ORK_ITEM` (a string as it
is, anything else as JSON) and `ORK_INDEX`
([scripts](../scripts.md#know-where-it-is-running)). `command:` runs without a
shell, so `$ORK_ITEM` is not expanded there, and redirects, pipes and `$( )`
don't work: write `{{item}}`, which stays one argument. A backslash escapes the
next character, so `\n` becomes `n`. For shell syntax, use `script:`.

## A model for each item

A Claude node's `model` and `effort` can read the item, so each item runs on its
own model:

```yaml
nodes:
  review:
    type: claude.worker
    prompt: "Review for {{item.concern}}."
    model: "{{item.model}}"
    forEach:
      items:
        - { concern: correctness, model: opus }
        - { concern: tests, model: sonnet }
```

Only `{{item.…}}` works there, and only on a node with `forEach`; `ork validate`
refuses `model: "{{index}}"`, a template on a node without `forEach`, and one in
`defaults:`. It checks each written item: a model is one word, an `effort` is
`low`, `medium`, `high`, `xhigh` or `max`. An item from `from:` is checked when
it runs, and one with a bad value fails on its own. An empty value uses the
default. `ork usage` shows each item's real model. `driver`, `budgetUsd` and
`maxTurns` can't come from an item.

## Pace and failure

- `maxParallel` caps the items running at once. It defaults to the run's
  `limits.concurrency`. A Claude item also takes a session slot and checks the
  budget before it starts.
- `onFailure: finish`, the default, runs every item and fails the node
  afterwards if any failed. `onFailure: stop` starts no more once one has
  failed; those running finish their turn. Items never started are `skipped`:
  the node's line counts only the ones that ran (`2 of 4 ran`), and `ork tree`
  and `ork logs` have no record of them.
- Each item has its own session, timeout and rounds, from the node's settings.
  The node has no timeout of its own.
- An item follows no edges. Only the node does, and its `notify:` fires once,
  for the node, after it gathered. A `messages` channel or `notify:` rule that
  goes to a node with `forEach` is refused.

## What comes out

A later node reads the gathered output:

| Field      | Holds                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `items`    | the list                                                                                          |
| `results`  | in list order, each item's declared output fields, its `summary`, and its `branch` and `worktree` |
| `statuses` | in list order, each item's `status` (`pass` or `fail` for a program), or `skipped`                |
| `count`    | how long the list is                                                                              |

```yaml
review:
  type: human.gate
  question: Which branches do you keep?
  document: "{{nodes.build.output.results}}"
```

A program's fields come only from its declared `json`; a program item that
failed also gets its `exitCode` and `error`. An `mcp.call` item gives no fields.

An empty list succeeds with `count: 0`. `when: all(statuses, 'pass')` on an edge
from the node tests every item. An item's full output stays in its own record,
`ork logs <run> --node build.2`.

A node with a failed item fails, and an edge without `when:` acts only on
success, so a gate after it would never ask. To see the passing items anyway,
give the edge `when: any(statuses, 'pass')`, as
[the example](../../../examples/fan-out.ork.yaml) does: the gate asks, and the
run succeeds. If every item fails, the edge isn't taken and the run fails.

## A list that is too long

When `from` gives more than `maxItems`, Ork asks before any item starts, as it
does for a loop out of rounds (its owner if working, else you):

- **stop** (recommended) fails the node and ends the run.
- **first** runs only the first `maxItems`.
- **all** runs every item.

## Worktrees

Each item has a worktree of its own, named `ork/<run>/build.2`, when the node
uses `isolation: worktree`. A node without a `parent` keeps its passing items'
branches as the run's result; combining them is a later node's job. A failed
item's worktree is kept too, with the reason `item failed; kept for inspection`.
With a `parent`, each passing item is merged into the owner's worktree, one at a
time. See [Worktrees and isolation](../worktrees.md).

A fanned node can't continue one worktree unless `maxParallel: 1`.

## Stopping, resuming and watching

- `ork stop --node build` stops the items running and starts no more.
  `ork stop --node build.2` stops one, and withdraws its open question or
  permission prompt. `ork stop`, `ork stop --node build` and Ctrl-C also end a
  wait on the too-long-list question; resuming asks it again.
- `ork resume` reruns only the items that hadn't finished, and keeps the list it
  had, so an edited file can't move results between items. A source that
  finished, in the run or an earlier resume, doesn't run again. A source that
  ran anew gives a new list, and then every item runs anew. A question still
  open when the run stopped is asked again.
- A loop that goes round again resolves the list again and reruns every item.
- A budget or quota spent stops new items. The node ends failed, cut off rather
  than failed by its work, and no edge acts on it.
- `ork tree` lists the items under their node, `ork logs --node build` keeps the
  node's events and its items', and `ork logs --node build.2` one item's; a
  skipped item or a mistyped id is an error (`Run has no node build.9.`). In
  [the browser](../browser-view/panels-and-workspace.md#the-panels) the node is
  one card with its progress and the items are rows under it.
