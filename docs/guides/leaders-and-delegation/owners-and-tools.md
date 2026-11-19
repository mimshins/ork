# Owners, tools and branches

_Part of [Leaders and delegation](../leaders-and-delegation.md)._

## Owners and children

A node names its owner with `parent`. Only an `agent.leader` can own nodes that
run on their own:

```yaml
nodes:
  builder:
    type: agent.leader
    prompt: "Implement: {{inputs.feature}}"
    model: claude-code.opus
    maxWorkers: 3
  tests:
    type: agent.worker
    parent: builder
    prompt: Write the tests for the part your owner describes.
  docs:
    type: agent.worker
    parent: builder
    prompt: Update the docs for the change your owner describes.
    model: claude-code.haiku
```

- A child with no incoming edge runs only when its owner delegates to it.
- A child can also have edges of its own; it then runs when they are taken too.
- The ownership tree cannot have cycles, and `ork validate` checks that every
  `parent` exists.

## What a leader can do

A leader in a run gets two tools. Both take a list of tasks, run them in
parallel, and return once every child has reported:

- **`delegate`**: give a brief to one or more of its declared children. The
  child's session starts with its own `prompt`, then a `## Task from <leader>`
  section with the brief.
- **`spawn_worker`**: start a new copy of a child worker, as `tests-2`,
  `tests-3`, and so on, up to the leader's `maxWorkers`. A copy has its
  template's settings and its own worktree. `maxWorkers` defaults to 0, and then
  the leader is not offered the tool at all.

In `delegate`, `child` is one of the leader's own children, and in
`spawn_worker`, `template` is one of its child workers. A name that is not
theirs fails the whole call with an error that lists the valid ids, and no task
runs. A child with [`forEach`](../writing-workflows/running-per-item.md) is left
out of both lists, since a wrong name fails the whole call: it runs from its
edges only, and `delegate` says so. To have the leader decide how many to run,
let it use `spawn_worker` on a plain worker, up to `maxWorkers`. A task is
refused, with the reason in its report, when its child is already running (two
`delegate` calls at once for one child start it once) or no workers are left.

A task's `description` labels the child in `ork tree`, `ork logs` and the
browser view: whitespace folds, secrets are masked, clipped to 80 characters.

## What comes back

Each child returns its report (status, summary, artifacts, branch) and its cost.
A child that failed is a report too, so the leader decides what to do: retry,
delegate to another child, or report a failure itself.

## How the branches fit together

1. Before the children start, Ork commits the leader's work so far, so they
   branch from it.
2. Each child works in its own worktree, on `ork/<run>/<child>`.
3. When a child passes, Ork merges its branch into the leader's worktree before
   `delegate` returns, so the leader sees the result in its own checkout.
4. A merge conflict is aborted and reported: the child's report carries
   `merge: { ok: false, conflicts, into }`, and its worktree stays for you.

When the same child runs again, its worktree first catches up with its owner's
branch.

## Leaders keep their session

A worker starts fresh every time it runs. A leader **resumes** its last session
when sent round a loop or delegated to again, with only the new input as the
next message, keeping its plan and prompt cache; a long `session: resume` worker
can [start fresh](../fresh-builder-sessions.md).

`session` changes either, for a node that runs again in a loop:

```yaml
reviewer:
  type: agent.worker
  agent: reviewer
  session: resume # check its own earlier findings in each round
```
