---
"@krapht/ork": patch
---

`ork logs -f --all --workflow <name>` follows only that workflow's live runs and
the runs they call. The Runs panel of `ork ui` keeps the last filter that worked
when it is drawn again (maximized or restored).
