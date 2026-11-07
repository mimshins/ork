# Quickstart

From an empty folder to a finished run. You need Ork installed and at least one
Claude driver ready ([Installation](./installation.md)).

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

You need Node, git and one ready Claude driver. `gh` and `aws` show as optional:
the starter workflow uses neither, so you can leave them uninstalled.

## 2. Create a starter workflow

```sh
ork init
```

```
created .ork/workflows/hello.ork.yaml
created .gitignore (.ork/runs/)
Runs use the driver that's ready when they start: cli here (2.1.314 (Claude Code), logged in (claude.ai)).
```

`ork init` never overwrites a file. It adds `.ork/runs/` to `.gitignore`,
because run state never belongs in git. (To keep Ork out of your repository
entirely, use `ork register` instead: see [projects](../guides/projects.md).) If
your project has a `.claude/` or `.opencode/` folder, it also links their agents
and skills folders to `.ork/`
([agents](../guides/agents.md#linking-your-tools-to-ork)). On a terminal it also
offers to write Ork's skills for Claude Code; either answer is fine here
([Ork from Claude Code](../guides/claude-code.md)).

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
  model: sonnet
  isolation: worktree
limits:
  budgetUsd: 5
nodes:
  lead:
    type: claude.leader
    prompt: "Plan this task and delegate it to your worker: {{inputs.task}}"
    model: opus
    maxWorkers: 2
  worker:
    type: claude.worker
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
- `approve` asks you whether to accept the leader's branch.
- `limits.budgetUsd: 5` caps the whole run at five dollars. No new session
  starts once that is spent.

The file names no Claude driver, as it's meant to be committed and your
teammates may log in another way. `ork run` uses the driver that's ready on the
machine running it, the CLI driver when both are, and says which before it
starts, e.g.
`No driver is named, so the run uses the cli driver: the one ready here (2.1.314 (Claude Code), logged in (claude.ai)).`
To pick one, add `driver: cli` or `driver: sdk` under `defaults` (in the
workflow, or in `.ork/project.yaml` for the whole project), set it on a node, or
pass `--driver` to `ork run`. If no driver is ready, the run doesn't start and
says how to get one ready, as `ork doctor` does.

## 3. Validate it

```sh
ork validate
```

```
✓ .ork/workflows/hello.ork.yaml (3 nodes, 1 edge, starts at lead)
```

`ork validate` checks every workflow in `.ork/workflows/` (or the files you
pass): the schema, the ownership tree, edges and loops, templates, and skill and
context references. Errors come with the file's line and column.

## 4. Run it

Before you start, two things to know:

- **The agents ask before they edit a file or run a command.** The starter's
  sessions run with Claude Code's usual permissions, so each prompt shows the
  tool and its input: type `y` to allow it. To stop being asked, allow those
  tools in the workflow (`tools.allow`, see
  [writing workflows](../guides/writing-workflows.md#claude-nodes)) or in your
  project's `.claude/settings.json`.
- **A run costs money.** On an API key or a cloud account it is billed there; on
  a Claude plan it counts against your plan's limits. The starter stops at five
  dollars. The run summary prints what it cost, and `ork usage` adds up your
  runs ([what you spent](../guides/models-and-budgets.md#what-you-spent)).

```sh
ork run hello --input task="add a README that explains what this project is"
```

`hello` is short for `.ork/workflows/hello.ork.yaml`. While it runs you see one
line per event, prefixed with the node's id: sessions starting, what the agents
say, each tool call, worktrees being created and merged, and each result. Then:

- The leader plans, delegates to the worker, and waits. Ork commits the leader's
  work first, so the worker branches from it.
- The worker works in its own worktree, on branch `ork/<run>/worker`. When it
  passes, Ork merges its branch into the leader's.
- The gate asks you on the terminal. Press Enter for the recommended answer, or
  type a number or an option's id.
- The run summary shows the status, the total cost, and the worktrees left for
  you, with their branches and paths.

`<run>` is the run's id, printed at the top and bottom of the transcript;
`ork ps` lists it too. Agents can also ask you questions while they work; they
appear on the terminal the same way. Ctrl-C stops the run.

To watch the run in your browser as well, start the browser view in another
terminal:

```sh
ork ui
```

Ork never pushes and never touches a branch outside `ork/`. Your checkout stays
as it was; the result is on the leader's branch.

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
not. It shows what it would remove and asks first:

```sh
ork worktrees clean --run <run> --all --branches --force
```

## Where next

- [The browser view](../guides/browser-view.md): your runs, their questions, and
  the Builder, in `ork ui`.
- See what a node's session loads, layer by layer:

  ```sh
  ork context explain hello lead
  ```

- [Writing workflows](../guides/writing-workflows.md): node types, edges,
  conditions and loops.
- [Leaders and delegation](../guides/leaders-and-delegation.md): owners,
  children, and spawned workers.
- [The example workflows](../guides/examples.md): bigger ones, such as
  `software-factory` and `pr-review`.
