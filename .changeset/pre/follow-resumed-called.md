---
"@krapht/ork": patch
---

`ork logs -f --all`, `ork decide --follow` and `ork attach` follow a called run
again when resuming its caller brings it back after it had ended.
