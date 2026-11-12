---
"@krapht/ork": patch
---

`ork tree` shows a run waiting for a `lock:` as `ork ps` does: its header reads
`waiting for <lock>, held by <run>/<node>`, and each waiting node's row reads
`waiting for <lock>`.
