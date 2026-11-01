---
"@krapht/ork": minor
---

New: `isolation: continue`. A Claude node with no owner works in the worktree
its input came from (found as for a readonly node, through control nodes and
gates), writes there, and has its work committed on that worktree's branch; with
no one worktree upstream it gets its own. A `continue` node can neither own
nodes nor have a parent (`tree.continue`). Workflows drafted with
`ork migrate --from-agents` now chain their agents in one worktree, so a later
agent sees an earlier one's edits.
