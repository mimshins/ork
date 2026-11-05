---
"@krapht/ork": minor
---

`ork validate` now tries every way through a workflow, without running a
session, a tool or a script. It warns about a node no way reaches and a loop
only its rounds can end, says how many ways it walked, and `--paths` lists how a
run can end. `ork run` prints the same warnings before it starts.
