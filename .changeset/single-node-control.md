---
"@krapht/ork": patch
---

`ork pause`, `ork continue` and `ork stop --node` (and the same routes of
`ork ui`) refuse a run of one node (`node-…`) with "stop the whole run instead",
where they used to say they had worked and do nothing. `ork stop` still stops
it.
