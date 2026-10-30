# ADR-018 — Ork merges a passing child's branch into its owner's

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / worktrees
- **RFC:** waived — the author chose among the options below directly

## Context

A `worktree` node works on its own branch, based on its owner's
([ADR-009](./ADR-009-worktree-per-writing-node.md)). Its changes have to reach
the owner, and ADR-009 left open whether Ork or the owner does the merge.

## Decision

When a child reports a passing status, **Ork** commits anything the session left
uncommitted (`ork: <node>`, with no attribution) and merges the child's branch
into its owner's with `git merge --no-ff`. On a conflict Ork aborts the merge
and tells the owner which branch to merge by hand. A root node's branch is left
for the user and named in the run summary. Built in M1c slice 2
([specs/scheduler.md](../specs/scheduler.md)).

## Options considered

- **Ork merges** — chosen.
- **The leader merges** with git in its own session: more flexible, but costs
  turns, depends on the model getting git right, and fails less visibly.

## Rationale

Merging a passing branch is mechanical; doing it in the engine makes it
predictable and visible in the run's events, and keeps the model's turns for the
work. Conflicts, the part that needs judgment, still go to the owner.

## Consequences

- Ork writes commits and merges, but only on `ork/<run>/<node>` branches and the
  owner's branch in Ork's worktrees (located by
  [ADR-020](./ADR-020-worktrees-beside-the-clone.md)); it never pushes or
  rewrites a user branch.
- Reviewers (`readonly`) never produce a merge.
