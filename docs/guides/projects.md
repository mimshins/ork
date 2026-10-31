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
