# ADR-100 — A run's own working root: `ork:security-audit` in attached projects

- **Status:** Accepted
- **Date:** 2026-11-17
- **Topic:** worktrees, built-in bundles, `ork run`, `tools/audit`
- **RFC:** [RFC-021](../rfcs/archived/RFC-021-audit-in-attached-projects.md)
  (option C)
- **Amends:** [ADR-096](./ADR-096-built-in-bundles.md) (item 6)

## Context

[ADR-096](./ADR-096-built-in-bundles.md) writes a built-in bundle under the
project's Ork folder, `.ork/runs/.builtin/<hash>/`, and its item 6 refused
attached projects: in a project registered with `ork register` that folder is
`~/.ork/projects/<id>/runs/.builtin/<hash>/`, outside the checkout, and the
audit's agents are read-only, so none of the three drivers lets them read it
([ADR-035](./ADR-035-projects-in-repo-or-attached.md)). `scan`, the first node,
exited 1 before any agent started.

## Decision

1. **A run of such a built-in gets a working root of its own.** When `ork run`
   runs an `ork:` built-in with companion files in an attached project, it opens
   a git worktree of the project's `HEAD` beside the clone (named by the
   project's git rules, branch `ork/<run>/audit-root`, or detached under
   `commit: never`), writes the bundle into it as `.ork/runs/.builtin/<hash>/`,
   and runs every node there: the workspace root, every session's folder, every
   tool node's folder. The agents read the bundle inside their own folder, so no
   read grant exists and `SessionSpec`, the runtime port and the workflow format
   do not change.
2. **Only the root changes.** The store, events, locks and the report folder
   (`~/.ork/audits/<project>/<run-id>/`) stay keyed by the user's checkout. The
   placeholder in the bundle's texts becomes the folder relative to the worktree
   root, so the texts and the hash are unchanged (the hash is taken before the
   replacement, as in ADR-096 item 3).
3. **The worktree is removed on every end** of the run (finish, failure, stop,
   discard, crash handler), with `git worktree remove --force` and its branch
   only while it still points at the base. It is recorded as a `worktree`
   `created` event and a `removed` one, so `ork worktrees` and
   `ork worktrees clean` find a leftover by its run id. A resume re-creates it
   at the **recorded** commit and writes the bundle again (or adopts the folder
   if it is still there), so the audited commit is the same across a stop and a
   resume.
4. **An attached audit sees `HEAD`.** The worktree is a clean checkout, so
   uncommitted changes and the untracked or ignored files of the checkout
   (`.env`, keys) are not in it. `scan` reads the env `ORK_SOURCE_ROOT`, which
   `ork run` sets on tool nodes only when the root is a run worktree (an
   identity key that a workflow's `env:` cannot set and a nested run does not
   inherit), and notes `audited commit <sha> (a per-run copy of HEAD)` and, when
   `git status --porcelain` of that checkout is not empty,
   `uncommitted changes in your checkout are not audited`. Both reach the
   report. `scope: diff:<ref>` is computed in the worktree, so it equals a
   `HEAD` diff.
5. **ADR-096 item 6 is amended:** attached projects are supported; the audit's
   refusal (`OUTSIDE_ROOT_MESSAGE`, the `bundleDir` option) is gone. Other
   built-ins with companion files stay refused in attached projects
   ([ADR-099](./ADR-099-onboard-refuses-attached-projects.md)).
6. **Ork writes only beside the clone and under `~/.ork`.** It never writes into
   the repository or `.git/info/exclude`, and the bundle's link guard applies
   inside the worktree. A `post-checkout` hook of the user's repository runs
   when the worktree is checked out, as it does for every worktree node
   ([worktrees](../specs/worktrees.md)).

## Spike result

Go. A throwaway test (an attached fixture, a fake runtime) showed that an agent
node and a `tool.shell` node both get the run worktree as their folder and read
a bundle file at the path in the prompt; that the store, events and locks (keyed
by the checkout) and `projectRoot` keep working when the root is swapped; that a
resume re-creates the worktree at the recorded commit; and that a leftover is
found by run id. It also showed that the audit never got as far as `scan` in an
attached project: `ork validate` and `ork run` already failed on
`ref.context ./security-audit/context/read-only-bash.md does not exist`, the
same cause.

## Options considered

From RFC-021:

- **A. A read grant for the bundle folder.** A session spec carries a read-only
  path and each driver turns it into its own rule. Audits the working tree with
  uncommitted changes, but changes the runtime port and three adapters, and
  widens what a read-only agent reaches. Ruled out for now.
- **B. A place inside the checkout that git ignores.** No runtime change, but it
  writes into the user's repository (or `.git/info/exclude`), against ADR-035
  and ADR-096 item 6. Ruled out.
- **C. A per-run worktree as the run's root (chosen).** No grant, no port
  change; the cost is that the audit sees `HEAD`.

## Consequences

- `ork:security-audit` runs in an attached project and audits the committed
  tree. Uncommitted changes in an attached project are not audited; an option
  for that needs a snapshot or a read grant
  ([audit limits](../specs/gaps/audit-limits.md)).
- A run of such a built-in makes a worktree beside the clone and costs a
  checkout of `HEAD`. A crash can leave it; `ork worktrees` lists it and
  `ork worktrees clean` removes it.
- The bundle is an untracked folder in the worktree, so the agents see it as
  files in the project; they are told it is not project content, and `scan`
  reads tracked files only.
- The pattern is cross-cutting (a run's root is no longer always the checkout),
  so it is hard to reverse: a later built-in with companion files can use it.
  Stored runs, events and `schemaVersion` are unchanged.

Spec: [worktrees](../specs/worktrees/run-root.md),
[built-in workflows](../specs/cli/built-in-workflows.md),
[audit limits](../specs/gaps/audit-limits.md).
