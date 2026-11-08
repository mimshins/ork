---
"@krapht/ork": patch
---

A workflow, `project.yaml`, `triggers.yaml` or settings file written by a newer
Ork now says so, with `ork upgrade` as the fix, instead of
`Invalid input: expected 1` and a list of unknown keys. `ork feedback import`
says the same of a line with a newer `feedbackVersion`.
