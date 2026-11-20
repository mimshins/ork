# Moving into the repository, and drafting a workflow

_Part of [Projects: in your repository, or beside it](../projects.md)._

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

On a terminal the last line is a `Go ahead?` with `Yes` and `No` (press `y` or
`n`); the `[y/N]` form above is what `--plain`, a pipe or `NO_COLOR` print.

It commits nothing: review the result with `git status` and commit it yourself.
If anything is already where a file would go, or a run of the project is live,
it moves nothing and says why. So does a `CLAUDE.md` or `AGENTS.md` it would
move into `.ork/`, where every contributor's agent tool would read it: it names
the file. `--dry-run` only shows the plan; `--yes` skips the question. In an
in-repo project, `ork migrate --agents` does only the agents part.

With `--agents` the plan is followed by a warning: linked tool folders and
`.ork/skills` reach every contributor's own agent tool, not only Ork's runs.
`ork init` says the same when it links or writes skills. `--no-link` and
`--no-skills` keep them out; no default changes.

## Drafting a workflow from your agents

If your process lives in your agents, draft a first workflow from them:

```sh
ork migrate --from-agents documenter,implementer --reviewer reviewer
```

This writes `workflows/process.ork.yaml` in the project's folder (`--name` picks
another name) and validates it; nothing else changes. The agents work one after
another in one worktree: the first opens it, and each one after it continues
there (`isolation: continue`), so it sees the earlier edits. A gate asks you
before the reviewer reads the last agent's change, and the reviewer sends it
back while it requests changes (three rounds at most). Then the change is
staged, a second gate shows you the staged summary, and it is committed on the
branch you give the run:

```sh
ork run process --input task="Add a health endpoint" \
  --input branch=feat/health --input message="feat: add a health endpoint"
```

The draft sets `git.commit: never`, so Ork commits nothing itself, and nothing
is pushed. Edit it to fit: models, budgets, prompts, or more gates.
