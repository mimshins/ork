# How Ork works

Ork runs a team of Claude agents and your own tools on your machine, in the
order you give it, and stops to ask you where it matters. This page says what
the parts are, in plain words.

## Workflows

A **workflow** is one YAML file, `.ork/workflows/<name>.ork.yaml`, committed
with your code. It lists the steps (the **nodes**), who owns whom, and how work
flows from one step to the next (the **edges**). You write it by hand, in the
Builder of `ork ui`, or with your agent; `ork validate` checks it before
anything runs ([writing workflows](./guides/writing-workflows.md)).

## Nodes

Each node is one step, of one of these kinds:

- **Leaders and workers:** Claude agents. A leader plans and hands parts of the
  job to the nodes it owns; a worker does one task and reports back.
- **Tools:** a program of yours, such as `git`, `gh`, `aws`, your tests or a
  short script, run without a model.
- **Gates:** a question for you, with options and a recommended answer.
- **Control:** joins that wait for several steps, and routers that pick a way.
- **Calls:** another workflow, started as a run of its own, or one tool on an
  MCP server.

A node can **own** others. The owner gives each child a short brief, not its
whole conversation, and gets a short report back. That keeps every agent's
context small, so runs cost less
([leaders and delegation](./guides/leaders-and-delegation.md)).

## Agent sessions

A leader or worker runs as a **session**: a Claude Code conversation that Ork
starts for that step, with only what the step needs: its brief, your
repository's `CLAUDE.md` or `AGENTS.md` and skills, and what the workflow adds
([skills and context](./guides/skills-and-context.md)). A worker starts a fresh
session each time; a leader picks its own up again. Ork reaches Claude through
your own `claude` login or your API key, and never stores either
([accounts](./guides/accounts.md)).

## Runs

A **run** is one go through a workflow, with its own id. `ork run` starts one
and shows what each node does as it happens; `ork ui` shows the same in your
browser. You can pause a run, stop it, talk to a node, and pick up a run that
didn't finish ([running workflows](./guides/running-workflows.md)). Budgets and
timeouts stop a run that costs or takes more than you allowed
([models and budgets](./guides/models-and-budgets.md)).

## Worktrees

Each agent that writes code works in its own **git worktree**: a second checkout
of your repository, beside it, on its own branch `ork/<run>/<node>`. Parallel
agents never edit the same files. When a child's work passes, Ork merges its
branch into its owner's. The run's result is a branch you review, merge or throw
away; Ork never pushes on its own ([worktrees](./guides/worktrees.md)).

## Decisions

When a run needs you, it waits: a gate, an agent asking a question, a tool that
needs your permission, a loop that used all its rounds. You answer in the
terminal that started it, in any other terminal with `ork decide`, or in the
Decisions panel of `ork ui`. Whichever answers first wins. An agent never
answers for you.

## What Ork keeps

Every run's events, decisions, costs and feedback go into one database on your
machine, `~/.ork/state.db`. `ork ps`, `ork logs`, `ork usage` and `ork ui` all
read it, so a run started in one shows in the others. Nothing about your runs
leaves your machine unless you send it
([where Ork keeps things](./guides/where-ork-keeps-things.md)).

## Next

[Installation](./getting-started/installation.md), or have
[your agent](./getting-started/with-your-agent.md) set Ork up.
