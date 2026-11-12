# Before a run starts

_Part of [Troubleshooting](../troubleshooting.md)._

**`… need a git worktree, but … is not in a git repository with a commit`.**
Nodes with `isolation: worktree` need a repository with at least one commit.
Make one, or pass `--in-place` to run in the current folder:

```sh
git init && git commit --allow-empty -m "Start"
```

**`this file was made by a newer Ork`.** A teammate's Ork wrote it with a higher
`schemaVersion`. Run `ork upgrade`; an older Ork can't read it.

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
