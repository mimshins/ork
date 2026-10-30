# Leaders and delegation

In Ork, a node can **own** other nodes. An owner hands each child only the brief
it needs, waits for a short report back, and gets the child's work merged into
its own branch. This keeps every session small: no child sees its owner's whole
conversation, and the owner never reads a child's transcript.

Contract details: [Scheduler: delegation](../../specs/scheduler.md#delegation)
and [Worktrees: delegation](../../specs/worktrees.md#delegation).

## Owners and children

A node names its owner with `parent`. Only a `claude.leader` can own nodes that
run on their own:

```yaml
nodes:
  builder:
    type: claude.leader
    prompt: "Implement: {{inputs.feature}}"
    model: opus
    maxWorkers: 3
  tests:
    type: claude.worker
    parent: builder
    prompt: Write the tests for the part your owner describes.
  docs:
    type: claude.worker
    parent: builder
    prompt: Update the docs for the change your owner describes.
    model: haiku
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

A task is refused, with the reason in its report, when the child is not the
leader's, is already running, or no workers are left.

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

A worker starts fresh every time it runs. A leader does not: when it is sent
round a loop again, or delegated to again by its own owner, it **resumes** its
last session with only the new input as the next message. It keeps its plan and
its prompt cache, which saves tokens on long jobs.

## Messages between nodes

Nodes in a run can write to each other while they work, with `send_message`: a
node to its owner, an owner to the nodes it owns (and the workers it spawned),
and any two nodes you connect with a channel:

```yaml
messages:
  - between: [security, code]
```

Anyone else is refused, and the agent is told whom it can write to. The
recipient gets a one-line notice at its next step, even in the middle of a task,
and reads the message with `read_inbox`; a node that is not running sees it when
it next starts. So a reviewer can warn the coder about something before its
report, without the leader passing it on.

## Claims: parallel writers stay apart

When nodes that write can run at the same time, Ork gives them `claim` and
`release` and tells them to claim a file or folder before they edit it. A claim
on a folder covers everything in it, and a name such as `db:migrations` works
for anything else shared. If another node holds it, the agent is told who, so it
can work on something else or message them; Ork tells it when the claim is
released. Claims are released when a node finishes, and `ork logs` shows them
(`⚑ claimed src/auth`). They steer agents rather than lock files, so they matter
most with `isolation: shared` or `--in-place`, where writers share one checkout,
and they head off merge conflicts between worktrees.

## A leader decides about its own loops

When a loop runs out of rounds and the leader that owns its nodes is still
working, Ork asks the leader, not you: stop, one more round, or go on. The
leader answers with its `answer` tool. If its session ends before it answers,
the question comes to you as usual.

## Concurrency and budget

- While a leader waits for its children, its session slot goes to them, so a run
  never deadlocks even at `limits.concurrency: 1`.
- Children count against the run's `limits.budgetUsd`. Once it is spent, no new
  child starts.

## See who did what

The run transcript marks a delegated run with its owner
(`tests │ claude.worker, for builder`), and the run summary lists spawned
workers by their instance ids. `ork tree` draws the ownership tree, with spawned
workers under the leader that spawned them, and `ork logs --node <id>` replays
one node's part. Messages show as `code │ ✉ to docs: …`, and a question to a
leader as `lead │ ? asked as the owner of fix: …`.

## Tips

- Give each child a narrow `prompt` that says what kind of work it does, and let
  the leader's brief say what to do this time.
- Put reviewers on a cheaper model, or a lower `effort`, than the leader
  ([Models, effort and budgets](./models-and-budgets.md)).
- Use `isolation: readonly` for children that only review: they work in the
  leader's checkout and cannot write.
