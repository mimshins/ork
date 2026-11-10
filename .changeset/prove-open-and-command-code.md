---
"@krapht/ork": minor
---

The `open-code` and `command-code` drivers are proven on real sessions and no
longer refused; `open-code` now takes `maxTurns`. Their gate runs found and
fixed four bugs: OpenCode worked in the main checkout instead of the node's
worktree (it reads `PWD`, which every session now gets), and its path rules
never matched, so every read was refused; Command Code's own print-mode gate
refused every shell call, and Ork's mod refused reads in the worktree and the
tool loader a session needs for Ork's `report`. `ork doctor` lists a driver
whose tool is missing as `skip` with how to install it.
