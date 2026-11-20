# An attached project

_Part of [`ork onboard`](./onboard.md)._

Status: **Built** (option D of
[RFC-022](../../rfcs/archived/RFC-022-onboard-in-attached-projects.md);
[ADR-114](../../decisions/ADR-114-onboard-in-attached-projects.md), which
supersedes
[ADR-099](../../decisions/ADR-099-onboard-refuses-attached-projects.md)). What
is not settled is in [the limits](../gaps/onboard-limits.md).

`ork onboard` works in a project attached with `ork register`
([ADR-035](../../decisions/ADR-035-projects-in-repo-or-attached.md)). Its files
live in `~/.ork/projects/<id>/`, and onboarding writes the picked workflows and
the rules there, never into the repository: no `.ork/`, no branch, no
`.gitignore` edit. The project still needs a git repository with a commit, since
the writer works in a worktree ([refusals](./onboard-flow.md#refusals)).

## Contents

- [Setting up and the run](#setting-up-and-the-run)
- [The writer and `finish`](#the-writer-and-finish)
- [The gate and keep](#the-gate-and-keep)
- [A folder that changed](#a-folder-that-changed)

## Setting up and the run

`prepare` never calls `initRecorded` or `uncommittedFiles` for an attached
project: no `created` line, no `.gitignore` edit, an empty `fromInit`, so the
writer's "not in your worktree" note is empty. The attached folder is not
written before the gate's keep.

`runWrite` passes `RunWorkflowOptions.seed` (the attached folder, `place.dir`)
for `ork:onboard-write` only; `ork:onboard-propose` runs as before. There is no
flag and no workflow-format field. The seed:

- forces `commit: never` for the run's node worktrees and its
  [run root](../worktrees/run-root.md) (a `merge: auto` becomes `patch`), so the
  writer's worktree is detached under every `commit` value and no `ork/<run>/…`
  branch is made in the repository;
- is recorded in the run's `settings.seed`, so `ork resume` seeds and detaches
  the same way, and a resumed run does not seed over the writer's work;
- seeds the writer's worktree as `<prefix>.ork/` with the folder's
  `workflows/*.ork.yaml` and `project.yaml` and one local commit, the seed
  commit ([worktrees](../worktrees.md#seeding-a-worktree)).

A project in a repository subfolder is seeded and kept under its prefix
(`<prefix>.ork/`); its run root opens from the repository's top
([the run root](../worktrees/run-root.md)).

Both built-ins get a run root (ADR-100): `propose` reads a copy of `HEAD`, and
the writer's worktree is cut from it. Both runs take their inputs as untrusted,
as `ork run` does for any `ork:` built-in.

## The writer and `finish`

The writer's `.ork/` is the project's own current files; its rule (`writing.md`)
says so, that they live in Ork's folder and not in the repository, and that its
scope is unchanged: only `.ork/workflows/*.ork.yaml` and `.ork/project.yaml`.
The writer still sees `HEAD`: uncommitted files of the checkout are invisible to
it and to `propose` ([L400](../gaps/onboard-limits.md)).

The `write` node's output carries `seed` (the seed commit), and the `finish`
node passes it as `--base`, so an existing workflow's `driver`, `model` and
agents are not new and its "needs your eye" list shows only real additions; a
workflow the writer left alone is not a change
([finish](./onboard-verbs.md#finish)). The canonical rewrite stays uncommitted,
as under `commit: never`.

## The gate and keep

The `changes` node prints the diff stat since the seed and says that keep
applies the files to Ork's folder and changes nothing in the repository. In a
seeded run it first stages the writer's new workflow and `project.yaml` files
that the repository ignores (`git ls-files -z -o -i --exclude-standard` over
`**/.ork/workflows/*.ork.yaml` and `**/.ork/project.yaml`, then `git add -f`),
so the stat lists what keep applies even when `.ork` is gitignored. The `keep`
question is one text for every run, so the place is in that output.

`keepRun` (`packages/cli/src/runs/keep.ts`) reads the run's `settings.seed` from
its events, so any caller behaves the same. For a seeded run it stages
`<prefix>.ork` with `git add -f` (it may be gitignored in the repository), takes
the worktree's change since its `HEAD` (the seed commit) relative to
`<prefix>.ork/`, creates the folder when it is missing and applies the patch
with `git apply --binary`, all or nothing
([worktrees](../worktrees.md#seeding-a-worktree) for the apply). Then the
worktree is removed. It prints, then the cited feedback items:

```
kept the workflows in <folder>: workflows/<file>, …
Nothing is in the repository: Ork keeps them in its own folder for this project.
removed <worktree>
```

The paths are real paths, not `~`. **Discard** and a run with nothing changed
remove the worktree and leave the folder as it was. A failed run (out of rounds,
a failed check) is not removed: it keeps its seeded worktree for `ork resume`,
which goes on in it and does not seed over the writer's work; only a discard or
a run with nothing to keep removes it. The folder is untouched in every case
until a keep applies.

## A folder that changed

If a file the patch touches changed in the folder between the seed and keep, the
patch fails: nothing changes, the worktree stays, and the command exits 1:

```
the workflows don't apply over <folder>, which changed since the writer started (<files>)
Nothing changed there; they stay uncommitted in <worktree>.
```

Run `ork onboard` again. Nothing is recorded to detect this earlier
([L542](../gaps/onboard-limits.md)). `ork keep` does not exist as a command
([L543](../gaps/onboard-limits.md)): `keepRun` serves `ork onboard` and
`ork feedback apply`, and only a seeded run applies to a folder.

Other limits of this path: the seed commit stays in `.git` until gc
([L541](../gaps/onboard-limits.md)), the seed commit still triggers the
`reference-transaction` hook ([L544](../gaps/onboard-limits.md)), the run root
keeps the name `audit-root` and leaves an empty folder
([L545, L546](../gaps/onboard-limits.md)), and in a project in a repository
subfolder `finish` flags the project's own files as outside the allowed paths
([L547](../gaps/onboard-limits.md)).
