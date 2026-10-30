---
"@krapht/ork": minor
---

Claude nodes and `defaults` take an `effort` (`low`, `medium`, `high`, `xhigh`,
`max`) next to `model`, so each node can think as hard as its task needs: for
example opus at `high` for the planner and sonnet at `low` for reviewers. A
node's own value wins, then `defaults`, then Claude Code's default for the
model. Both drivers pass it on (`effort` for the Agent SDK, `--effort` for the
CLI).
