---
"@krapht/ork": minor
---

`ork validate` now warns when a workflow could queue on a driver that holds one
session per checkout (Command Code): session nodes that share a checkout and can
run at once. The warning names the driver and the nodes, and says to give them
separate worktrees or use another driver.
