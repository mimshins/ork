# Running a node once per item

_Part of [Scheduler](../scheduler.md)._

Status: **Built**: the fan-out, the gather, how limits, stop and pause reach
items, [resuming per item](./resuming-and-events.md#resuming-a-run), item
[worktrees](../worktrees.md), the question about a list over `maxItems` and
[the walk](./walking.md#fanned-nodes) are built
([fan-out.ts](../../packages/core/src/run/fan-out.ts),
[replay.ts](../../packages/core/src/run/replay.ts),
[tests](../../packages/core/test/fan-out.test.ts),
[resume tests](../../packages/core/test/fan-out-resume.test.ts),
[list over its cap](../../packages/core/test/fan-out-exceeded.test.ts),
[walk](../../packages/core/test/walk-fanned.test.ts)), and `ork tree`,
`ork logs` and the `ork run` transcript show items
([CLI](../cli/running-and-runs.md)), and the Monitor and the Builder show fanned
nodes ([graph](../ui/graph.md), [Monitor](../ui/panels-runs-and-monitor.md),
[Builder](../ui/panels-builder-for-each.md)). Each item's own `model` and
`effort` from `{{item}}` are built
([item-settings.ts](../../packages/core/src/graph/item-settings.ts),
[tests](../../packages/nodes/test/item-models.test.ts)). Contract:
[RFC-013](../../rfcs/archived/RFC-013-for-each.md).

A node with `forEach` runs once per item of a list, with no model turn spent on
fanning out or gathering.

## An activation

- **The node's activation** resolves its list: `items` as written, or `from` to
  a value. Anything but a list fails the node, in the words of a declared field:
  ``tasks is `fix it`, expected a list``. `each.listed` records the list.
- **Each item** is an `Activation` `<id>.<i>`, counted from 0, with `template`
  set to the node and `item` to its entry. It runs through the type's own
  executor, its own session, timeout and round count. The scheduler reads only
  `forEach`, so an executor added through the registry fans out unchanged.
- **The node takes no session slot** and has no timeout of its own; each item
  does. `node.started` and `node.finished` for the node bracket the fan-out, so
  every view reading them sees one node.
- **An item follows no edges.** Only the node routes, and `notify:` fires once,
  for the node, reading what it gathered.
- **A loop round** resolves the list again and reruns every item. Item `build.i`
  in round two is round two of that id, so `session: resume` resumes its
  session.

## An item's own model and effort

An agent node's `model` and `effort` may be a template reading `item`
(`{{item.model}}`), so one fanned node runs its items on different models, as
`build`'s `review` runs one Opus reviewer and two Sonnet ones. The plan renders
them per item, before the budget check and the driver fit check, so those see
the item's real model; the session and `ork usage` show it too.

- **Only a `forEach` node, reading only `item`.** `ork validate` refuses a
  template on a node without `forEach`, one reading `index`, `inputs` or
  `nodes`, and one in `defaults.model` or `defaults.effort`.
- **A written item is checked when validated:** its model is a non-empty name
  with no space, brace or quote, and its effort is a level. An item from `from:`
  is checked when it runs, and one with a bad value fails that item with the
  message, not the node's other items.
- **An empty render** (a missing or empty field) falls back to the node's
  default, then `defaults`, then Claude Code's.
- **Not from an item:** `driver`, `budgetUsd`, `maxTurns` and every other field
  ([L262](../gaps/for-each-limits.md)).

## Pacing and failure

- `maxParallel`, default `limits.concurrency`, caps the items running at once,
  for every node type.
- A Claude item also takes a
  [session slot](../scheduler.md#budget-and-concurrency) and a budget check, and
  a `workflow.call` item a budget check, before it starts. A paused item keeps
  no slot.
- `onFailure: finish`, the default, runs every item, and the node fails
  afterwards if any failed. `onFailure: stop` starts no more once one has
  failed; those running finish their turn.

## A list over `maxItems`

`each.listed` records the whole list, then `each.exceeded` that it is too long.
The run asks whoever owns the node while that session is live, and the human
otherwise, through the same path as
[a loop out of rounds](../scheduler.md#loops):

- `stop`, the recommended answer and the one with no terminal: the node fails
  and the run ends `failed`, with no edge acted on and no `notify:` fired.
- `first`: only the first `maxItems` items run, and `items`, `results`,
  `statuses` and `count` hold those. A second `each.listed` of the same round
  records the shorter list, which is what a card counts and a resume hands back.
- `all`: every item runs.

On resume, the answer given last time is given again, in order, as a loop's is,
so a run stopped this way stops there again.

## The gathered output

The node's output is:

| Field      | Holds                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`    | the list                                                                                                                                                                                                                                             |
| `results`  | in list order, each item's declared output fields (a program's and an MCP call's come from its `json`), its `summary`, Ork's `branch` and `worktree` when it has them, and a failed program's `exitCode` and `error`; `{}` for an item never started |
| `statuses` | in list order, each item's `status`, or `pass`/`fail` from how it ended, or `skipped` for one never started                                                                                                                                          |
| `count`    | how long the list is                                                                                                                                                                                                                                 |

`ok` holds when every item succeeded. An empty list succeeds with `count: 0`. A
later node reading `{{nodes.build.output.results}}` gets every item's branch, as
readable text in a gate's `question` or `document`
([ADR-068](../../decisions/README.md)). An item's full output stays in its own
`node.finished`.

## A leader's fanned child

- A fanned child runs from its edges only. It is left out of `delegate`'s
  `child` enum and `spawn_worker`'s `template` enum, since a wrong enum value
  fails the whole call, and `delegate`'s description says why it isn't listed.
- **Claims.** A leader's claims are released only while it waits in `delegate`
  or `spawn_worker`. A fanned child's items are not in that wait, so they
  contend with the leader's claims like any node outside its team: they get the
  usual refusal and are told on release. Decided in the for-each plan
  (2026-11-08).

## Limits, stop and pause

- **Budget or quota spent** stops new items and the run ends as it does today.
  The node finishes failed, cut off rather than failed by its work: its
  `notify:` doesn't fire, and no edge acts on it.
- **`ork stop --node build`** stops the items running and starts no more; the
  node fails `stopped by the user`, keeping what it gathered. It also ends the
  wait for an answer on a list over `maxItems`: the question is withdrawn and no
  item starts. So does a stop of the whole run, which a resume asks again.
- **`ork stop --node build.2`** stops one running item; `onFailure` decides the
  rest.
- **Pausing** the node holds its items, as for a spawned worker's instances.
