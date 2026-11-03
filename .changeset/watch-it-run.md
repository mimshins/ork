---
"@krapht/ork": minor
---

`ork ui` has its Monitor: the selected run's graph and ownership tree, live,
with each node's status, model, tokens and cost. Pause, continue and stop the
run or a node from it; stop asks first, and a control that does not apply says
why. A `workflow.call` opens the run it started, and a run lists its links to
other runs. A run now records its edges and channels, so its graph shows what it
ran even after the workflow file changes.
