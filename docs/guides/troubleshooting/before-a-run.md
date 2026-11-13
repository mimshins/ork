# Before a run starts

_Part of [Troubleshooting](../troubleshooting.md)._

**`… needs a git worktree, but … is not in a git repository with a commit`**
(`… need a git worktree, …` when several nodes are named). Nodes with
`isolation: worktree` need a repository with at least one commit. Make a first
commit, or pass `--in-place` to run in the current folder (a workflow that
builds in parallel, like `issues`, needs the commit):

```sh
git init && git commit --allow-empty -m "Start"
```

**`this file was made by a newer Ork`.** A teammate's Ork wrote it with a higher
`schemaVersion`. Run `ork upgrade`; an older Ork can't read it.

**`schemaVersion is missing: write schemaVersion: 1`.** A project, workflow or
settings file has no `schemaVersion`. Add `schemaVersion: 1` as its first line.

**`no workflow file <name>; a file name or path is meant, not a workflow name`.**
`ork run` and `ork validate` take a workflow's file name (`issues`, or
`.ork/workflows/issues.ork.yaml`), not the `name:` inside it. The message lists
this project's workflows by file name, and adds the `name:` when it differs.

**`These instructions, skills or agents have uncommitted changes …`.** Worktrees
only get committed files, so Ork stops rather than run agents on instructions
you are not seeing. Commit the listed files, or pass `--allow-dirty` to run with
the committed versions.

**`This workflow runs programs that are not installed`.** A `tool.gh`,
`tool.aws` or `tool.shell` node runs a program that is not on your `PATH`.
Integrations are optional, so Ork only asks for the ones a workflow uses:
install the program (and sign in with its own login), or take the node out.

**`Not started: your day quota … is spent`, or a run ends `quota_exhausted`.** A
[limit across runs](../models-and-budgets/across-runs-and-time.md#limits-across-runs)
is spent, or your Claude plan refused a session. Wait until the time it gives,
or raise the cap in `~/.ork/settings.yaml` or `.ork/project.yaml`, then resume
the run:

```sh
ork resume <run>
```

**Your plan's limit has lifted, but Ork still refuses.** Ork remembers what
Claude Code last said about your plan's limits. Once the limit has lifted, make
it forget:

```sh
ork usage --clear-plan-limits
```

**``missing required input `feature` (`--input feature=…`)``.** Pass every
required input:

```sh
ork run <workflow> --input feature="…"
```

**`ref.skill` or `ref.context` errors.** A skill or context path resolves to
nothing. Paths are relative to the workflow file, start with `./` or `../`, and
must stay inside the project; a skill path points at a folder with a `SKILL.md`.
Project skills are never listed: they load by themselves
([skills and context](../skills-and-context.md)).

**A cycle without `maxRounds`.** Every loop needs a bound on one of its edges
([writing workflows](../writing-workflows.md#loops)).

**`` `x` uses worktree isolation, which a run on its own does not set up ``.**
`ork run --node` sets up no worktrees. Add `--in-place`, or run the whole
workflow.
