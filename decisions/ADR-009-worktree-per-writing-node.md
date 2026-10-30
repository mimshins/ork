# ADR-009 — A git worktree per writing node

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / isolation
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Several Claude nodes may edit the same repository at once: a builder and its
workers, parallel designs, fixes after review. Running them in one checkout lets
their edits collide and makes each node's changes impossible to review or
discard on their own.

## Decision

Each node declares an `isolation`:

- `worktree` (the default): the node gets its own git worktree and branch, based
  on its owner's branch; the owner reviews and merges its descendants' branches;
- `shared`: the node works in its owner's checkout (or the project root);
- `readonly`: a shared checkout with write tools denied.

Until the worktree manager lands (milestone M1c), a `worktree` node runs only
with an explicit `--in-place`, which runs it in the project checkout
([plan.ts](../packages/core/src/run/plan.ts)). Details:
[specs/context.md](../specs/context.md),
[specs/architecture.md](../specs/architecture.md).

## Options considered

- **One shared working directory** with file claims. Simplest; parallel writers
  still collide, and one node's mess blocks the rest.
- **Containers per node.** Strongest isolation; heavy for a local tool, and the
  project's own tooling may not run inside them. Left for later.
- **Configurable per node, worktree by default** — chosen.

## Rationale

Worktrees are cheap, built into git, and give each node a branch that is easy to
review, merge, or throw away. Read-only nodes such as reviewers gain nothing
from a worktree, so they share.

## Consequences

- Worktrees live under `.ork/worktrees/` (gitignored) and are cleaned up with
  the run.
- Ork needs the project to be a git repository for writing nodes; `ork doctor`
  warns otherwise.
- Merging is the owner's job, so conflicts surface at the owner, not mid-run.
