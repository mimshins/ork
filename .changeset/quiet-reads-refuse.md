---
"@krapht/ork": minor
---

`pnpm ork …` and `pnpm -s ork …` are no longer shipped reads, because `pnpm`
runs the project's own `ork` script; use the installed `ork …`. The Codex,
Command Code and omp guards now allow the shipped reads (`ork logs`, `jq`,
`head`, `ls`, …) inside the worktree on a line with no `cd`, and a call a
driver's guard refused three times in a node is filed as a `tool.refused`
feedback item on Codex, OpenCode, Command Code and omp. OpenCode still allows no
shipped read.
