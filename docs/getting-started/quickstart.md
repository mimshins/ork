# Quickstart

From an empty folder to a finished run. You need Ork installed and at least one
agent driver ready ([Installation](./installation.md)).

Want Claude Code to do these steps with you? See
[With your agent](./with-your-agent.md).

## 1. Check your setup

Ork works inside a git repository with at least one commit, because each writing
node gets its own git worktree. Use an existing project, or make a scratch one:

```sh
mkdir try-ork && cd try-ork
git init && git commit --allow-empty -m "Start"
ork doctor
```

You need Node, git and one ready agent driver (`git commits` warns before the
first commit). `gh` and `aws` are optional: the starter uses neither.

## 2. Create a starter workflow

```sh
ork init
```

```
created .ork/workflows/hello.ork.yaml
created .gitignore (.ork/runs/)
Runs use the driver that's ready when they start: claude-code here (2.1.314 (Claude Code), logged in (claude.ai, firstParty)).
Ork's skills for Claude Code: add them here with `ork init --skills`, or install Ork's plugin in Claude Code (/plugin marketplace add mimshins/ork, then /plugin install ork@ork).

Next: edit .ork/workflows/, then run ork validate.
```

`ork init` never overwrites a file. It adds `.ork/runs/` to `.gitignore` under
`# Ork run state`: run state never belongs in git (to keep Ork out of git
entirely, see [`ork register`](../guides/projects.md)). It links the agents and
skills folders of a `.claude/` or `.opencode/` folder to `.ork/`
([agents](../guides/agents.md#linking-your-tools-to-ork)), and keeps one that is
a real folder (`kept … is a real folder, left as it is`). On a terminal it
offers Ork's skills for Claude Code; either answer is fine
([Ork from Claude Code](../guides/claude-code.md)). With no commit yet it warns
(`! git: no commit yet…`) and still writes the files.

The starter workflow is a leader, the worker it owns, and a question for you at
the end:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/workflow.schema.json
schemaVersion: 1
name: hello
description:
  A leader plans the task, a worker does it, and you approve the result.
inputs:
  task:
    type: string
    required: true
    description: What to do.
defaults:
  model: claude-code.sonnet
  isolation: worktree
limits:
  budgetUsd: 5
nodes:
  lead:
    type: agent.leader
    prompt: "Plan this task and delegate it to your worker: {{inputs.task}}"
    model: claude-code.opus
    maxWorkers: 2
  worker:
    type: agent.worker
    parent: lead
    prompt: Do the part of the task your owner gives you, then report.
  approve:
    type: human.gate
    question: Accept the result on {{nodes.lead.output.branch}}?
    options:
      - accept
      - reject
    recommended: accept
edges:
  - lead -> approve
```

- `lead` plans and hands work to `worker` (its child, through `parent: lead`),
  and may start up to two more copies of it (`maxWorkers: 2`).
- `approve` asks whether to accept the leader's branch, read from its `branch`
  output (with none, it reads `Accept the result on ?`).
- `limits.budgetUsd: 5` caps the run at five dollars. No new session starts once
  that is spent, a running session counting at its last reported cost.

The file names no driver, as it's meant to be committed and your teammates may
log in another way. `ork run` uses the driver that's ready on the machine
running it, and says which before it starts. To name one, add
`driver: claude-code` under `defaults`, or see
[installation](./installation.md#check-your-setup).

## 3. Validate it

```sh
ork validate
```

```
 OK  .ork/workflows/hello.ork.yaml (3 nodes, 1 edge, starts at lead)
Walked 3 ways through: 2 succeed, 1 fails. See each with `ork validate --paths`.
```

`ork validate` checks every workflow in `.ork/workflows/` (or the files you
pass): the schema, the ownership tree, edges and loops, templates, and skill and
context references, with each error's line and column. Then it walks every way
through; the one that fails is the leader failing, which skips the gate
([every way through](../guides/writing-workflows/checking.md#every-way-through)).

## 4. Run it

Before you start, two things to know:

- **The agents ask before they edit a file or run a command.** Each prompt shows
  the tool and its input: type `y` to allow it. To stop being asked, allow those
  tools in the workflow (`tools.allow`, see
  [writing workflows](../guides/writing-workflows.md#agent-nodes)) or in your
  project's `.claude/settings.json`.
- **A run costs money**, billed to your API key or cloud account, or counted
  against your Claude plan. The summary prints it; `ork usage` adds them up
  ([what you spent](../guides/models-and-budgets/driver-and-usage.md#what-you-spent)).

```sh
ork run hello --input task="add a README that explains what this project is"
```

`hello` is short for `.ork/workflows/hello.ork.yaml`. While it runs you see one
line per event, prefixed with the node's id: sessions starting, what the agents
say, each tool call, worktrees being created and merged, and each result. Then:

- The leader plans and delegates; Ork commits its work first, so the worker
  branches from it.
- The worker works in its own worktree, on branch `ork/<run>/worker`. When it
  passes, Ork merges its branch into the leader's.
- The gate asks on the terminal. Press Enter for the recommended answer, or move
  with ↑/↓ for another (`n` adds a note; [`--plain`](../guides/terminal.md) asks
  the numbered way). `reject` ends the run as succeeded too (step 5).
- The run summary shows the status, the total cost, and the worktrees left for
  you, with their branches and paths.

`<run>` is the run's id, at the top and bottom of the transcript and in
`ork ps`. Agents' questions appear the same way; `ork decide` answers them too.
An answer other than the recommended one is kept as local feedback
([feedback](../guides/feedback.md#what-stays-on-your-machine)). Ctrl-C stops the
run, at a question too.

To watch the run in your browser as well, run `ork ui` in another terminal of
your own; an agent's shell gets no sign-in link.

Ork never pushes and never touches a branch outside `ork/`. Your checkout stays
as it was; the result is on the leader's branch. With `git.commit: never`
([never committing](../guides/project-rules.md#never-committing)) there is no
leader branch, only a path holding the uncommitted changes; step 5's branch
commands don't apply.

## 5. Keep the result, or throw it away

The leader's work stays in its worktree beside your clone, in
`../try-ork-worktrees/`. Review it like any branch:

```sh
git log ork/<run>/lead
git diff HEAD...ork/<run>/lead
```

To keep it, merge it, then tidy up what the run left:

```sh
git merge ork/<run>/lead
ork worktrees                   # every ork/ branch, its worktree, unmerged commits
ork worktrees clean             # removes merged ones; asks first
```

To throw it away instead, remove the run's worktrees and branches, merged or
not. It shows what it would remove, and the changes and commits that would be
lost, and asks first:

```sh
ork worktrees clean --run <run> --all --branches --force
```

## Where next

- [The browser view](../guides/browser-view.md): your runs, their questions, and
  the Builder, in `ork ui`.
- `ork context explain hello lead`: what a node's session loads, layer by layer.
- [Writing workflows](../guides/writing-workflows.md): node types, edges,
  conditions and loops.
- [Leaders and delegation](../guides/leaders-and-delegation.md): owners,
  children, and spawned workers.
- [The example workflows](../guides/examples.md): bigger ones, such as
  `software-factory` and `pr-review`.
