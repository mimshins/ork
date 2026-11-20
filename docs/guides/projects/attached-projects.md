# Registering a project from outside

_Part of [Projects: in your repository, or beside it](../projects.md)._

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

So a workflow can later move into the repository unchanged. Skills must be in
the repository (or in your own `~/.ork/`); agents can also be in
`~/.ork/projects/<id>/agents/`.

A context path that lands inside `.ork/` reads Ork's folder for the project
instead, so notes that should not be in your repository can sit beside the
workflows. These both load `~/.ork/projects/<id>/context/a.md`:

```yaml
# ~/.ork/projects/<id>/project.yaml
context: [.ork/context/a.md]
```

```yaml
# ~/.ork/projects/<id>/workflows/review.ork.yaml
layers:
  context: [../context/a.md]
```

The file must be a plain file inside that folder: a link, or a path that leaves
the folder, is refused, so a cloned repository cannot aim a reference at another
file of yours. `ork validate` says which folder it searched, and names a missing
file. A context path outside `.ork/` still reads your repository.
`ork context explain` shows the file as `.ork/context/a.md`, and
[`ork migrate`](./moving-into-the-repository.md) moves it there unchanged.

## Listing, moving and forgetting

```sh
ork projects                # every registered project, in-repo and attached (--ids, --limit, --json)
ork projects forget app     # forget it; its files and runs are kept
ork projects move app ~/src/app  # you moved or renamed the clone
```

`ork onboard` works in an attached project: it reads your repository, and what
you keep goes into `~/.ork/projects/<id>/workflows/`, never into the repository
([Onboarding](../onboarding.md#in-a-project-attached-with-ork-register)).

`ork init` records an in-repo project, and refuses one that is registered from
outside, so it never writes into it. On a terminal it also offers Ork's skills
for Claude Code, so it writes workflows Ork accepts
([Ork from Claude Code](../claude-code.md)).

## Keeping Ork out of your repository's knowledge

When other contributors use their own agent tools in the repository, what Ork
writes there reaches them. Four things keep the two apart:

- **The `quiet` practice**, on by default, tells every node never to write about
  Ork into a repository file, a commit message, a pull request or a review
  comment ([built-in practices](../skills-and-context.md#built-in-practices)).
- **`knowledge: ork-only`** in `project.yaml` limits `ork feedback apply` to the
  project's `.ork/` folder: a write anywhere else, and any file named
  `CLAUDE.md` or `AGENTS.md` even under `.ork/`, is refused with the reason
  ([asking for a fix](../feedback/acting-on-items.md#asking-for-a-fix)). In an
  attached project that folder is outside the repository, so the command is
  refused with a message naming the rule; make that change by hand.
- **A warning.** `ork init` (when it links tool folders or writes skills) and
  `ork migrate --agents` warn that linked tool folders and `.ork/skills` reach
  every contributor's own agent tool, and name `--no-link` and `--no-skills`.
  Their defaults do not change.
- **No instructions under `.ork/`.** `ork doctor` warns about a `CLAUDE.md` or
  `AGENTS.md` found under `.ork/` (run files in `runs/` are skipped), and
  `ork migrate` moves nothing while it would put one there, naming the file. Put
  the text in `.ork/context/` instead.
