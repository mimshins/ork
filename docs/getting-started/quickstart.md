# Quickstart

From an empty project to a finished run in five commands. You need Ork installed
and at least one Claude driver ready ([Installation](./installation.md)).

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
```

`ork init` never overwrites a file. It adds `.ork/runs/` to `.gitignore`,
because run state never belongs in git. (To keep Ork out of your repository
entirely, use `ork register` instead: see [projects](../guides/projects.md).) If
your project has a `.claude/` or `.opencode/` folder, it also links their agents
and skills folders to `.ork/`
([agents](../guides/agents.md#linking-your-tools-to-ork)). The starter workflow
is a leader, the worker it owns, and a question for you at the end:

```yaml
name: hello
inputs:
  task:
    type: string
    required: true
defaults:
  driver: sdk
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
    options: [accept, reject]
    recommended: accept
edges:
  - lead -> approve
```

- `lead` plans and hands work to `worker` (its child, through `parent: lead`),
  and may start up to two more copies of it (`maxWorkers: 2`).
- `approve` asks you whether to accept the leader's branch.
- `limits.budgetUsd: 5` caps the whole run at five dollars.

If only your `claude` login is ready (not an API key), change `driver: sdk` to
`driver: cli`, or pass `--driver cli` to `ork run`.

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

Agents can also ask you questions, and ask permission for a tool, while they
work; both appear on the terminal the same way. Ctrl-C stops the run.

Ork never pushes and never touches a branch outside `ork/`. Your checkout stays
as it was; the result is on the leader's branch.

## 5. Look at the result and tidy up

The leader's work stays in its worktree beside your clone, in
`../try-ork-worktrees/`. Review it like any branch:

```sh
git log ork/<run>/lead
git diff HEAD...ork/<run>/lead
git merge ork/<run>/lead        # when you want it
```

Then list and clean what runs left behind:

```sh
ork worktrees                   # every ork/ branch, its worktree, unmerged commits
ork worktrees clean             # removes merged ones; asks first
```

## Where next

- See what a node's session loads, layer by layer:
  `ork context explain .ork/workflows/hello.ork.yaml lead`.
- [Writing workflows](../guides/writing-workflows.md): node types, edges,
  conditions and loops.
- [Leaders and delegation](../guides/leaders-and-delegation.md): owners,
  children, and spawned workers.
- Bigger examples: `software-factory` (spec, build, three parallel reviews with
  a fix loop, an approver, then your go-ahead to open a pull request) and
  `pr-review`, in [The example workflows](../guides/examples.md).
