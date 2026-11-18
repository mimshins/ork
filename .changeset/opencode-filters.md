---
"@krapht/ork": patch
---

`ork doctor` warns about an `opencode` older than 2.3.2, whose sessions never
saw Ork's tools, and OpenCode sessions may pipe a command's output through
`head`, `tail`, `sed`, `awk` or `grep` again.
