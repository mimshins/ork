# ADR-037 — `isolation: continue`: write in the worktree your input came from

- **Status:** Accepted
- **Date:** 2026-11-01
- **Topic:** worktrees / workflow format
- **RFC:** waived — the author chose this option over the others below
- **Builds on:** [ADR-020](./ADR-020-worktrees-beside-the-clone.md) (worktrees
  beside the clone), [ADR-029](./ADR-029-readonly-follows-its-input.md) (a
  readonly node follows its input), [ADR-036](./ADR-036-ork-migrate.md) (drafted
  workflows)

## Context

A worktree node always gets a worktree of its own, branched from its owner's
branch or `git.base`. Two writers one after another in the flow, such as a
documenter then an implementer, therefore work in two checkouts: the second does
not see the first one's edits, except reported artifacts that are missing in its
own. On se-backend, a drafted workflow's documenter edited `README.md` in its
worktree and the implementer, in a clean one, made the change again (gap L21).
Only a leader's children shared work, by being merged into it.

## Decision

1. **A new isolation value, `continue`.** A Claude node with no owner and no
   children works in the worktree its input came from, found as for a readonly
   node: its incoming edges are followed back through control nodes and gates to
   the nodes that ran, and when they all worked in one worktree, it works there,
   with its write tools.
2. **Otherwise its own worktree.** With no such worktree (it is an entry, or its
   inputs worked in different places), it gets a worktree of its own, as
   `worktree` does; it never falls back to the project root.
3. **Its work is committed where it worked.** After the node, Ork commits its
   leftovers on that worktree's branch (`ork: <node> (run <id>)`), unless
   `commit: never`. Its output's `worktree` and `branch` are that worktree's.
   Nothing is merged: the worktree is the node it came from's, and is kept or
   merged as that node's.
4. **Outside the ownership tree.** A node that sets `continue` and has a
   `parent` or children is an error (`tree.continue`); `continue` from
   `defaults` on such a node means `worktree`.
5. **Drafted workflows use it.** `ork migrate --from-agents` gives the first
   agent `worktree` and each one after it `continue`, so the chain works in one
   checkout and the reviewer reads all of it.

## Options considered

- **Readonly advisers:** draft only the last agent as a writer and the others
  `readonly`, their reports its brief. No format change, but a documenter that
  writes specs could not write them. Rejected by the author.
- **Keep it a gap** until the review at the end of the roadmap. Rejected: the
  se-backend run showed real duplicated work.
- **Carry every changed file, not only missing artifacts:** copies drift, and
  two writers' edits to one file would need a merge Ork does not do.
- **`worktree: <node>`, naming whose worktree to use:** more explicit, but a
  second way to say where a node works, and it breaks when that node is skipped.
  Following the input reuses ADR-029's rule.

## Rationale

A worktree per writer suits work that is independent or owned by a leader that
merges it. A chain of writers is one change made in steps, which belongs in one
checkout; following the input says that without naming nodes, and the rule is
the one readonly reviewers already use, so writers and reviewers after them
agree on where the change is.

## Consequences

- Writers in a chain see each other's edits, and a reviewer after them reads the
  whole change. `{{nodes.<id>.output.worktree}}` is the shared worktree for
  every node in the chain.
- Two `continue` nodes that run at once in one worktree can collide; claims are
  advisory ([gaps](../specs/gaps.md), L10).
- A `continue` node cannot own children; a leader that needs its own checkout
  for them keeps `worktree`.
- Gap L21 is closed.
