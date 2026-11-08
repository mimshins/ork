---
"@krapht/ork": patch
---

A node can now run once per item of a list with `forEach`: a `claude.worker`, a
tool node, an `mcp.call` or a `workflow.call` takes a list written in the file
(`items`) or one an earlier node reports (`from`, with `maxItems`), runs each
item in its own session and worktree, up to `maxParallel` at a time, and
finishes once with the results in order. `{{item}}`, `{{index}}`, `ORK_ITEM` and
`ORK_INDEX` read the item, a run resumes per item, a list over `maxItems` asks
whether to stop or go on, and `ork tree`, `ork logs --node` and `ork validate`
show and check items. The Monitor and the workflow builder don't draw them yet.
