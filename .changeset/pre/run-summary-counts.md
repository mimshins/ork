---
"@krapht/ork": patch
---

A run that skipped nodes or handled a failure still reads `succeeded`, and now
says so: the run result, `ork run`'s last line
(`2 ran, 1 skipped, 1 failure handled`), `ork ps --json` (`skipped`,
`failuresHandled`) and the Monitor's stat strip count both. `ork run` also warns
about each node that never ran but had messages nobody read. `ork ps` shows a
called run's cost dimmed as `in <caller>`, since its caller's cost already
counts it.
