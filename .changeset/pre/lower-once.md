---
"@krapht/ork": patch
---

A `low`-priority session or tool command is lowered once, by `nice`, not twice:
it could land at the lowest priority instead of below Ork's.
