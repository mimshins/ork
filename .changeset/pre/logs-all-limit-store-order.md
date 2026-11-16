---
"@krapht/ork": patch
---

`ork logs -f --all --limit N` keeps the last N lines in the order they print
(stored order: time, then run, then sequence), not run by run. Core exports
`compareStoreOrder`, the one comparator for both.
