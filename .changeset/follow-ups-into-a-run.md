---
"@krapht/ork": patch
---

`ork run <workflow> --follow-ups due` takes every due agent follow-up of the
project as the run's brief, alone or beside ids (each once). With nothing due it
exits 1 and starts no run. A bare `--follow-ups`, `--follow-ups ""` or one
followed by another flag now says it needs follow-up ids or `due` and names
`ork follow-ups list`, instead of "missing required input brief". Tab after
`--follow-ups` offers `due` and the project's open agent follow-ups, with their
titles.
