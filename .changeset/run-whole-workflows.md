---
"@krapht/ork": minor
---

`ork run <workflow>` now runs the whole workflow: flow edges and `when:`
conditions, `control.split`, `control.router` and `control.join`, bounded loops
that ask you when they run out of rounds, `tool.gh` / `tool.aws` / `tool.shell`
nodes (no shell; checked against their `allow` list), `human.gate` with
timeouts, and the run's budget and concurrency limits. The transcript prefixes
each line with its node, and the run ends with a summary. Worktree nodes still
need `--in-place` until the worktree manager lands.
