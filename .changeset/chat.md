---
"@krapht/ork": minor
---

New: `ork chat <run> <node>` talks to a leader or worker. While the run is
going, each message reaches the node at its next step, even mid-task, and its
replies stream back; a node that is not running gets it when it next starts.
After the run, `ork chat` resumes the node's own session where it ran, so it
remembers its work, and the exchange is added to the run's log. `-m` sends one
message; `--driver` picks the driver for a resumed session. `ork logs` now also
prints what comes after a run's summary.
