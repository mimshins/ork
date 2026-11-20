# ADR-114 — `ork onboard` in attached projects: a seeded, detached worktree

- **Status:** Accepted
- **Date:** 2026-11-21
- **Topic:** `ork onboard`, projects, worktrees
- **RFC:** [RFC-022](../rfcs/archived/RFC-022-onboard-in-attached-projects.md)
  (option D)
- **Supersedes:** [ADR-099](./ADR-099-onboard-refuses-attached-projects.md)
- **Amends:** [ADR-100](./ADR-100-audit-in-attached-projects.md) (item 5)

## Context

[ADR-099](./ADR-099-onboard-refuses-attached-projects.md) kept `ork onboard`
refusing a project attached with `ork register`, since its writer works in a
worktree of the repository and an attached project's workflows live in
`~/.ork/projects/<id>/`, outside it
([ADR-035](./ADR-035-projects-in-repo-or-attached.md)). It kept option D of
RFC-022 for when attached users asked for onboarding. They did. The writer needs
the real source to read and a path under `.ork/` to write, and Ork must not
write into the repository or hand a driver a new read or write grant.

[ADR-100](./ADR-100-audit-in-attached-projects.md) already gives an `ork:`
built-in with companion files a working root of its own in an attached project,
and its item 5 left the other bundles (`ork:onboard-*`) refused.

## Decision

1. **`ork onboard` accepts an attached project.** The refusal and its
   `ork migrate` text are gone. A git repository with a commit is still
   required, and doctor's checks are unchanged. `prepare` never calls
   `initRecorded` or `uncommittedFiles` for it: no `.ork/`, no branch, no
   `.gitignore` edit, no `created` line.
2. **The writer's worktree is seeded and detached.** `createWorktree` and
   `openWorktree` take an optional `seed: { from, to, paths }`. Ork copies the
   named files of `~/.ork/projects/<id>/` (`workflows/*.ork.yaml`,
   `project.yaml`) to `<prefix>.ork/` in the new worktree, through the
   plain-file guards, and makes one local commit, the seed commit, with plumbing
   (`git add -f`, `commit-tree --no-gpg-sign`, `update-ref`) so no commit hook
   runs and a gitignored `.ork` is taken. The worktree is detached. `ork run`
   takes the folder as `RunWorkflowOptions.seed`, which forces `commit: never`
   for the run's node worktrees and its run root, so no `ork/<run>/…` branch
   exists in the repository under any `commit` value. The folder is recorded in
   `run.started`'s `settings.seed`, so a resume seeds and detaches the same way
   and never seeds over the writer's work.
3. **`finish` compares with the seed.** `ork __onboard finish` takes an optional
   `--base <commit>` (default `HEAD`); the `write` node's output carries the
   seed commit and the workflow passes it only for a seeded run. An existing
   workflow's `driver`, `model` and agents are not new, its eye list shows real
   additions only, and an unchanged workflow is no change.
4. **Keep applies to Ork's folder, all or nothing.** `keepRun` reads the run's
   `settings.seed`, takes the worktree's change since the seed commit relative
   to `<prefix>.ork/` (`changesSince(…, relativeTo)`) and applies it to the
   folder with `git apply --binary` (`applyChanges`, with
   `GIT_CEILING_DIRECTORIES` so a folder inside another repository is applied to
   as it is). A file that changed in the folder since the seed fails the patch:
   nothing changes, the worktree stays, exit 1. Discard, a failed run and no
   change leave the folder as it was.
5. **ADR-100 item 5 is amended:** `ork:onboard-propose` and `ork:onboard-write`
   are supported in an attached project, on the run root ADR-100 introduced. No
   state file, store event type, `SessionSpec`, runtime port or workflow format
   field changes; `onboard-write.ork.yaml`'s text does (its bundle hash).

## Options considered

From RFC-022:

- **A — write into the attached folder, diff against a recorded baseline:**
  needs a per-driver write grant outside the worktree (the class of G14), a new
  place for state, and changes the live workflows before the person decides.
- **B — a scratch repository in Ork's folder, copied back on keep:** the writer
  loses the project's source or needs a read grant for it.
- **C — keep refusing (ADR-099).**
- **D — seed the worktree with the attached files, run `finish` unchanged, apply
  the result on keep (chosen).** Inside D, an untracked seed read by
  `finish --baseline <folder>`, or the existing files as an inline input, were
  rejected: the seed commit lets `finish`, the `changes` node and the gate keep
  their git logic. Refusing the keep when the folder changed at all needs a
  recorded hash; overwriting it loses the person's edits. Applying the patch,
  all or nothing, is the same rule as the in-repo `commit: never` keep.

## Rationale

D gives the writer the real source in its own folder with no new grant for any
driver; Ork, not the agent, reads two named paths of the attached folder and
writes into it at keep, from a patch the same `finish` checks vetted (only
`.ork/workflows/*.ork.yaml` and `.ork/project.yaml`, added or modified).
`git apply` refuses a path outside its folder and a write through a link.

## Consequences

- An attached user can run `ork onboard` with the repository untouched; the
  advice to `ork migrate` first is gone. The writer still sees `HEAD`:
  uncommitted files of the checkout are not seen
  ([L400](../specs/gaps/onboard-limits.md)).
- The seed commit is a dangling object in the repository's own `.git` until gc;
  it holds the attached rules (which may name `env` keys, never values). Nothing
  is pushed ([L541](../specs/gaps/onboard-limits.md)). A repository's
  `reference-transaction` and the worktree's `post-checkout` hooks still run
  ([L544](../specs/gaps/onboard-limits.md)).
- A folder edited after the seed is found only at keep
  ([L542](../specs/gaps/onboard-limits.md)); there is no `ork keep` command
  ([L543](../specs/gaps/onboard-limits.md)); the run root keeps the name
  `audit-root` and leaves an empty folder after a discard
  ([L545, L546](../specs/gaps/onboard-limits.md)).
- A seeded, detached worktree is a cross-cutting pattern (a worktree that starts
  with files that are not the repository's), so it is hard to reverse: a later
  built-in can use it. Stored runs, events and `schemaVersion` are unchanged;
  `settings.seed` and the `worktree` event's `seed` are optional.

Spec: [an attached project](../specs/cli/onboard-attached.md),
[worktrees](../specs/worktrees.md#seeding-a-worktree),
[the run root](../specs/worktrees/run-root.md),
[projects](../specs/projects.md).
