---
"@krapht/ork": minor
---

`ork validate` and `ork run` now refuse a node its driver can't serve, before
anything is spent, in words that name both: `maxTurns` on a driver with no turn
limit, `budgetUsd` on one that reports no dollars (a token budget is planned), a
leader that delegates on a driver that can't reach Ork's tools, and any node on
a driver not yet proven on a real session. `ork validate --driver <id>` checks
against that driver; without it, against the one a run would take.
