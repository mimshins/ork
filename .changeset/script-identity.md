---
"@krapht/ork": minor
---

Tool nodes can steer a run without a model turn. A program now sees who it is
(`ORK_RUN`, `ORK_NODE` and more), a node takes an `env:` that can read your own
variables as `{{env.NAME}}`, and `output: { format: json }` gives `output.json`
from stdout or `$ORK_OUTPUT`. `ork chat` now refuses when run by a program or an
agent in a run.
