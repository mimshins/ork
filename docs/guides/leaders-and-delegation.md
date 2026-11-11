# Leaders and delegation

In Ork, a node can **own** other nodes. An owner hands each child only the brief
it needs, waits for a short report back, and gets the child's work merged into
its own branch. This keeps every session small: no child sees its owner's whole
conversation, and the owner never reads a child's transcript.

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
runs. A child with [`forEach`](./writing-workflows/running-per-item.md) is left
out of both lists, since a wrong name fails the whole call: it runs from its
edges only, and `delegate` says so. To have the leader decide how many to run,
let it use `spawn_worker` on a plain worker, up to `maxWorkers`. A task is
refused, with the reason in its report, when its child is already running or no
workers are left.

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

`session` changes either, for a node that runs again in a loop:

```yaml
reviewer:
  type: agent.worker
  agent: reviewer
  session: resume # check its own earlier findings in each round
```

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

A leader's claims never get in its children's way. When it hands out work with
`delegate` or `spawn_worker`, Ork releases what it holds, so its children can
claim those paths, and tells it so in the result. It claims again before it
edits. Children still contend with each other and with nodes outside the team.
The items of a fanned child are not in that wait, so they contend with the
leader's claims like any node outside its team.

## A leader decides about its own loops

When a loop runs out of rounds and the leader that owns its nodes is still
working, Ork asks the leader, not you: stop, one more round, or go on. The
leader answers with its `answer` tool, and can add a note saying why. If its
session ends before it answers, the question comes to you as usual.

## A leader can answer its children's questions

By default, a child's `ask_user` question comes to you. Set `questions: owner`
on a leader to have it answer its children's questions first:

```yaml
lead:
  type: agent.leader
  prompt: Build the approved spec in specs/feature.md
  questions: owner
```

Ork asks a copy of the leader's session, which can only read files (no shell, no
subagents, no MCP servers of your own), while the leader itself keeps working or
waiting. If the leader's task and what you agreed with it already settle the
question, it answers, and the child goes on. If not, it passes the question to
you with a note, and you see the child's question with "lead passed this on: …"
under it. You're also asked when the leader hasn't started a session yet, or the
copy fails, or runs out of turns, budget or its 5 minutes. A paused run starts
no copy until you continue it; one already asking finishes its few turns. If you
stop the child, its question is withdrawn.

The copy's cost is the run's, counted against the leader, and it doesn't share
the leader's prompt cache, so each question pays for reading the leader's
session again. In the logs its lines say `fork`, and the leader's chat shows one
line for it. Gates and permission prompts always come to you. Every answer is a
decision that says who gave it: `ork decide --list` shows the child "via lead",
the transcript shows the leader's name after an answer it gave, and the
Decisions panel says "Answered … by `lead`, its owner". A leader with no
`agent.leader` or `agent.worker` child can't set `questions`.

## Concurrency and budget

- While a leader waits for its children, its session slot goes to them, so a run
  never deadlocks even at `limits.concurrency: 1`.
- Children count against the run's `limits.budgetUsd`, after what the leader's
  own session set aside. Once it is spent, no new child starts.

## See who did what

The run transcript marks a delegated run with its owner
(`tests │ agent.worker, for builder`), and the run summary lists spawned workers
by their instance ids. `ork tree` draws the ownership tree, with spawned workers
under the leader that spawned them, and `ork logs --node <id>` replays one
node's part. Messages show as `code │ ✉ to docs: …`, and a question to a leader
as `lead │ ? asked as the owner of fix: …`.

## Tips

- Give each child a narrow `prompt` that says what kind of work it does, and let
  the leader's brief say what to do this time.
- Put reviewers on a cheaper model, or a lower `effort`, than the leader
  ([Models, effort and budgets](./models-and-budgets.md)).
- Use `isolation: readonly` for children that only review: they work in the
  leader's checkout and cannot write.

For the full rules:
[the scheduler's delegation](../../specs/scheduler.md#delegation) and
[worktrees in delegation](../../specs/worktrees.md#delegation).
