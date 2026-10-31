# Projects: in your repository, or beside it

Ork keeps a folder of its own for each project: your workflows, your
[project rules](./project-rules.md), each run's files, lessons, and your own
agents. That folder is either in your repository or outside it.

- **In the repository** (`ork init`): `.ork/`, committed with your code, so your
  process is reviewed like code.
- **Beside it** (`ork register`): `~/.ork/projects/<id>/`. Ork writes nothing
  into your repository: no `.ork/`, no links, no `.gitignore` entries. Use this
  for a project with its own process that should not change for Ork, or one you
  only try Ork on.

The contract is in [projects](../../specs/projects.md).

## Registering a project from outside

From your clone (or with its path):

```sh
ork register
```

```
registered app → /work/app

Workflows: ~/.ork/projects/app/workflows/ · rules: ~/.ork/projects/app/project.yaml · runs: ~/.ork/projects/app/runs/
Nothing is written into /work/app. In it, ork run <name> finds the workflows above.
```

Then put your workflows in `~/.ork/projects/app/workflows/` and, if you want
rules, a `project.yaml` beside them:

```yaml
# ~/.ork/projects/app/project.yaml
schemaVersion: 1
git:
  commit: never
  branch: "{inputs.type}/{inputs.slug}"
  worktrees: "../{clone}-worktrees/{inputs.type}-{inputs.slug}"
```

Inside your clone, `ork run review`, `ork validate` and `ork context explain`
find `review.ork.yaml` there. Runs, `ork ps`, `ork decide` and `ork worktrees`
work as for any project. `--id` picks the id; it is the clone's folder name by
default.

## Paths in an attached workflow

A workflow in `~/.ork/projects/<id>/workflows/` reads your repository as if it
were in `.ork/workflows/` inside it:

```yaml
layers:
  context: [../../docs/process.md] # your repository's docs/process.md
```

So a workflow can later move into the repository unchanged. Skills and context
files must be in the repository (or in your own `~/.ork/`); agents can also be
in `~/.ork/projects/<id>/agents/`.

## Listing and forgetting

```sh
ork projects                # every registered project, in-repo and attached
ork projects forget app     # forget it; its files and runs are kept
```

`ork init` records an in-repo project, and refuses one that is registered from
outside, so it never writes into it.

## Moving into the repository

`ork migrate` moves an attached project into its repository: everything in
`~/.ork/projects/<id>/` goes to `.ork/`, `.ork/runs/` is added to `.gitignore`,
and the project becomes in-repo. With `--agents`, it also brings your agents and
skills under `.ork/` and points your tools' folders at them:

```console
$ ork migrate --agents
Plan:
  move   ~/.ork/projects/app → .ork
  remove ~/.ork/projects/app once it is empty
  move   .ai/agents/reviewer.md → .ork/agents/reviewer.md
  link   .ai/agents → ../.ork/agents
  link   .claude/agents → ../.ork/agents
  …
  ignore .ork/runs/ in .gitignore
  record app as in-repo
Go ahead? [y/N]
```

It commits nothing: review the result with `git status` and commit it yourself.
If anything is already where a file would go, or a run of the project is live,
it moves nothing and says why. `--dry-run` only shows the plan; `--yes` skips
the question. In an in-repo project, `ork migrate --agents` does only the agents
part.

## Drafting a workflow from your agents

If your process lives in your agents, draft a first workflow from them:

```sh
ork migrate --from-agents documenter,implementer --reviewer reviewer
```

This writes `workflows/process.ork.yaml` in the project's folder (`--name` picks
another name) and validates it; nothing else changes. The agents work one after
another, each in its own worktree. A gate asks you before the reviewer reads the
last agent's change, and the reviewer sends it back while it requests changes
(three rounds at most). Then the change is staged, a second gate shows you the
staged summary, and it is committed on the branch you give the run:

```sh
ork run process --input task="Add a health endpoint" \
  --input branch=feat/health --input message="feat: add a health endpoint"
```

The draft sets `git.commit: never`, so Ork commits nothing itself, and nothing
is pushed. Edit it to fit: models, budgets, prompts, or more gates.

## A worked example: a project with its own process

se-backend keeps its agents in `.ai/agents` (a documenter, an implementer, a
reviewer), names branches `<type>/<slug>` with a worktree each beside the clone,
and lets a human commit. Moving that process into Ork, without writing into the
repository:

1. `ork register`, then rules in `~/.ork/projects/<id>/project.yaml`:

   ```yaml
   schemaVersion: 1
   git:
     commit: never
     base: origin/main
     worktrees: "../{clone}-worktrees/{inputs.type}-{inputs.slug}-{node}"
   permissions:
     allow:
       [Read, Glob, Grep, Write, Edit, "Bash(git status*)", "Bash(git diff*)"]
     deny: ["Bash(git push *)"]
   defaults: { model: haiku, driver: cli, budgetUsd: 0.6, maxTurns: 30 }
   ```

2. `ork migrate --from-agents documenter,implementer --reviewer reviewer`, then
   edit the draft: inputs `type` and `slug` instead of `branch`
   (`switch -c {{inputs.type}}/{{inputs.slug}}`), and a run budget.
3. `ork run process --input task=… --input type=docs --input slug=… --input message="docs: …" --detach`,
   and answer its questions with `ork decide`: a permission the rules do not
   cover, the gate before the reviewer, and the commit.

The run cost a few cents on haiku. The reviewer read the implementer's worktree,
the second gate showed the staged summary, and the commit landed on the new
branch; the clone's own checkout stayed as it was. Two things to know:

- Permission patterns are Claude Code's: `Bash(git diff*)` does not match
  `git -C <path> diff`, so that call was asked about.
- Each drafted agent has its own worktree, so an earlier agent's edits do not
  reach the next one ([gaps](../../specs/gaps.md)); keep the writing to one
  agent, or edit the draft to fit.
