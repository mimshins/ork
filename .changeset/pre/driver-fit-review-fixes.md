---
"@krapht/ork": patch
---

Driver fit is stricter, and Command Code and OpenCode sessions are safer:

- `ork validate` and `ork run` refuse a leader and a node it owns that share a
  checkout on a driver holding one session per checkout (Command Code): they
  would wait for each other forever. Siblings still only get a warning.
- They also refuse a workflow's `limits.budgetUsd`, and a node's `mcp` servers,
  on a driver that can't keep them (Command Code), naming the node and driver.
- `ork validate` checks every node that names no driver against the one a run
  would take, so an unproven ready driver is reported before `ork run`.
- An interrupt while a session is still being wired up now stops it before it
  starts; a session that ends in an error is no longer continued to deliver a
  queued message; an OpenCode message starting with `-` is no longer read as a
  flag; a corrupt Command Code lease record no longer makes sessions wait
  forever.
