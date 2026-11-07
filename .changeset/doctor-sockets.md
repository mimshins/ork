---
"@krapht/ork": patch
---

`ork doctor` warns when your home folder's path is too long for a run's socket
(103 bytes on macOS, 107 on Linux), which made answers and commands wait up to a
second without a word.
