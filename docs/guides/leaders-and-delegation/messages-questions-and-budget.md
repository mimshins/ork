# Messages, questions and budget

_Part of [Leaders and delegation](../leaders-and-delegation.md)._

## Messages between nodes

Nodes in a run can write to each other while they work, with `send_message`: a
node to its owner, an owner to the nodes it owns (and the workers it spawned),
and any two nodes you connect with a channel:

```yaml
messages:
  - between: [security, code]
```

Anyone else is refused, and so is a child writing to a leader that waits on it
in `delegate` (it asks with `ask_user` or decides); the agent is told why. The
recipient gets a notice at its next step and reads it with `read_inbox`; a node
not running sees it when it starts. So a reviewer can warn the coder before its
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
  own session set aside. Once it is spent, no new child starts. A resumed turn
  blames this budget only for its own spend
  ([the rule](../../../specs/scheduler.md#budget-and-concurrency)).
- A worker that has its own `budgetUsd` (or `budgetTokens`) and is offered less
  than that, because siblings have set budget aside, waits for a sibling to
  finish and then starts with its own cap, instead of starting on a few cents.
  Under a tight run budget workers can therefore run one after another. It never
  waits for a leader.
- The run ends `budget_exhausted` only when its budget is really spent. A worker
  that runs out of what the others left it fails as its own `budget_limit`,
  which an edge can route, and the run goes on.

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
  ([Models, effort and budgets](../models-and-budgets.md)).
- Use `isolation: readonly` for children that only review: they work in the
  leader's checkout and cannot write.
