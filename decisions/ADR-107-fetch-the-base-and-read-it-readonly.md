# ADR-107 — Fetch a remote `git.base`, and let readonly nodes read a fresh base worktree

- **Status:** Accepted
- **Date:** 2026-11-20
- **Topic:** projects / git, worktrees
- **RFC:** waived by the maintainer (a decision made directly; options below)
- **Amends:** [ADR-032](./ADR-032-project-rules.md) (the base is no longer
  "never fetched")

## Context

A run must start from the base the project names. Two things broke that:

1. `git.base: origin/main` was whatever the clone last fetched, because Ork
   never fetched (gap L16). A run could start from a stale main.
2. A `readonly` node with no owner and no upstream worktree read the user's
   checkout ([ADR-029](./ADR-029-readonly-follows-its-input.md)), which may be
   on another branch or hold uncommitted files, and so gave wrong answers.
   Attached projects worked around both with a refresh tool step plus a stub
   worktree node for the readonly node to follow.

## Decision

Two optional keys in the git rules, in `.ork/project.yaml` and a workflow's
`rules.git`. Existing files stay valid; no `schemaVersion` bump.

- **`git.fetch: auto | never`, default `auto`.** When the rendered `git.base`
  names a remote-tracking ref, Ork runs
  `git fetch --no-tags <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>`
  before it resolves the base. Only that ref is written: no tags, no prune, no
  other remote, never a push, never a checked-out branch.
  `git rev-parse --symbolic-full-name` decides what is a remote ref, so `HEAD`,
  a local branch, a tag or a commit is never fetched. It runs with
  `GIT_TERMINAL_PROMPT=0` and a 60 second timeout, using the user's own
  credentials. A failure stops the run before any node, naming git's reason, the
  ref and `git.fetch: never`, with any `user:token@` in a URL removed. A resume,
  a caller's `baseRef` and a run root handed a base do not fetch: they use the
  recorded or given commit.
- **`git.readonly: checkout | base`, default `checkout`.** With `base`, readonly
  nodes with no owner and no upstream worktree share one detached worktree at
  the resolved base commit, beside the clone under the reserved id `_readonly`,
  with no ignored local files (so no `.env`). It is recorded by `worktree`
  `created` and `removed` events and removed, forced, when the run ends. It is a
  no-op with an owner or an upstream worktree, with `--in-place`, and with a run
  root. A `continue` node after it gets a worktree of its own.

## Options considered

- **A failed fetch as a warning, or fail only when no local copy exists.** Keeps
  an offline run going, but then "never start from a stale main" holds only when
  the network does. Rejected: fail the run, and name `git.fetch: never` as the
  opt-out.
- **`fetch: never` as the default.** Keeps today's behavior and surprises no one
  offline, but leaves the stale-main problem to every project. Rejected.
- **The readonly choice as a per-node field.** More precise, but a new field in
  the node schema for what projects set once. Rejected for the smaller change, a
  git rule; a per-node option can come later.
- **Readonly nodes always at the base.** Would change what every existing
  workflow's readonly nodes see, including those that want the user's checkout.
  Rejected.

## Consequences

- A workflow-format change, hard to reverse: two keys users will write into
  their project files. Both are optional and have defaults, so older files and
  Ork versions that ignore unknown git keys are unaffected.
- A user's behavior changes: a remote `git.base` now costs one network call at
  each run start, and offline or no-access users must set `git.fetch: never`.
  Said in the release notes.
- A shared readonly worktree is not isolated per node: readonly nodes are denied
  write tools, and the tree is thrown away.
- Closes gap L16. Attached projects can drop their refresh step and stub node
  and set `git.readonly: base` instead.
- No new dependency, runtime-port change, event type or CLI command.
