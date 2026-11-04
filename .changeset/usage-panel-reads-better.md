---
"@krapht/ork": patch
---

The Usage panel keeps its chart in view in the default dock, labels columns with
their dates when there is room, marks the day or week still going, lines up its
costs, lists only days with spend in its table, and offers `ork usage` commands
and a retry. `ork usage --since 7d` now counts seven whole days, as the panel
does. The Runs panel and the CLI show no spend as `$0.00`.
