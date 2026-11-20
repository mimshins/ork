---
"@krapht/ork": patch
---

`ork run --detach` and `ork resume --detach` no longer fail with
`the run did not start in time` when a driver's CLI is slow during the start:
the background process shows it is starting, and the command waits up to two
minutes for it (15 seconds with no sign of life). A node that finds too little
budget left now gives up its reserve only when another node's reserve can free,
so a node starting beside it can no longer be offered dollars the run's budget
does not have.
