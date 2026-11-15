---
"@krapht/ork": patch
---

A watched trigger's hash now takes a digest of the bytes of each in-project file
its check names, not the file read as UTF-8 text, so a binary that changes only
in bytes that aren't UTF-8 turns the trigger off too.
