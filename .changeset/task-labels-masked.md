---
"@krapht/ork": patch
---

Task labels (a leader's task `description`) are masked of secrets before they
are clipped to 80 characters, and clipped by code point so an emoji is never cut
in half; `ork tree` lines its columns up by code point. The live run stream, the
lead's `delegate` tool-call line, `ork tree` and `ork logs` mask them too, and
`ork tree --help` and `ork logs --help` describe them. In `ork ui`, the
Monitor's node table shows the whole label on hover, and a graph card shows it
on a third line (cards are now 60 px tall).
