---
"@krapht/ork": patch
---

A node's `lock:` name reads only `{{inputs.*}}`, as ADR-085 says: `ork validate`
now refuses `{{run.*}}` in it with `lock.scope`, as it already did
`{{nodes.*}}`.
