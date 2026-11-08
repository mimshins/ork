---
"@krapht/ork": patch
---

A workflow no longer needs to name a Claude driver, and `ork init`'s starter
names none, since `.ork/workflows/` is committed and one person's login doesn't
belong in it. When nothing names a driver (the node, its agent, the workflow,
`.ork/project.yaml`'s `defaults.driver`, or `--driver`), `ork run` uses the one
`ork doctor` finds ready on the machine running it, `cli` when both are, and
says so in one line; with neither ready it stops before any session starts, with
`ork doctor`'s hints. The run records the driver, and `ork resume` keeps it.
`ork init` says which driver runs would use here. Before, such a workflow ran on
the SDK driver.
