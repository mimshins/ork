---
"@krapht/ork": minor
---

New: feedback capture. Ork notes what got in the way of a run, on your machine
only: system signals from the run's own events (a loop out of rounds, a budget
that ran out, a tool you denied, an Ork tool that failed, a gate that timed out,
an answer other than the recommended one) and reports from agents through a new
`feedback` tool (at most 3 per session). Records about the same thing are
grouped into items: `ork feedback list`, `ork feedback show <item>` and
`ork feedback dismiss <item>`.
