# ADR-029 — A readonly node with no owner works where its input came from

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** worktrees / placement
- **RFC:** waived — the author chose this when a real `software-factory` run
  showed the problem; the options are below

## Context

[ADR-020](./ADR-020-worktrees-beside-the-clone.md) puts `shared` and `readonly`
nodes in their nearest owner's worktree, or the project root. In a real run of
`software-factory` the `approver` (readonly, no owner, after the builder's
reviews) worked in the project root. The builder's branch lives in a worktree
beside the clone, outside the approver's folder, so reading it asked for
permission, was denied, and the approver escalated: it could not see what it was
asked to judge.

## Decision

A `readonly` node with no owner works in the worktree its input came from
([upstream.ts](../packages/core/src/worktree/upstream.ts)): its incoming edges
are followed back through control nodes (joins, splits, routers) to the nodes
that ran. When they all worked in one worktree, the node works there, told it is
in that node's worktree; otherwise, as before, the project root. Only `readonly`
nodes move, so nothing writes to another node's branch.

## Options considered

- **An explicit `checkout: <node>` field:** clear and author-controlled, but a
  workflow format change, and every reviewer after a leader would need it.
- **Example only** (`parent: builder` on the approver): no engine change, but
  the leader could then delegate to its own approver, and the general case stays
  broken.
- **`shared` nodes too:** a shared node after a leader would write on the
  leader's branch. Rejected.

## Consequences

- Reviewers and approvers after a leader see its branch with no extra fields.
- A readonly node fed by two worktrees stays in the project root; give it an
  owner to choose one.
- Specified in
  [specs/worktrees.md](../specs/worktrees.md#where-each-node-works).
