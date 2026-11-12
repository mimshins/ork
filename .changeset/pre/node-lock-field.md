---
"@krapht/ork": patch
---

A node can name a `lock`. Workers, tool nodes and `mcp.call` take `lock: <name>`
(one name per node, which may read `{{inputs.*}}`, for example
`branch:{{inputs.branch}}`), parsed and checked by `ork validate`. The run holds
it across the nodes that name it, as a later entry of this release says.
