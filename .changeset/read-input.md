---
"@krapht/ork": patch
---

A node sent back by a loop with more than its message holds (8 KiB) reads the
whole with the new `read_input` tool, so the end of a long review is no longer
lost
