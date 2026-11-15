---
"@krapht/ork": minor
---

`ork once --on <pathspec>` (repeatable) keys a check by only the files the git
pathspecs match, so an edit elsewhere still hits; a pathspec git rejects stops
with git's message and exit 1 before the command runs. Repeating `--covers` now
records a pass for every name, not only the last.
