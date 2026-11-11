---
"@krapht/ork": patch
---

`priority: low` now starts sessions and tool commands under `nice` (and, on
macOS, utility QoS), so they run lower from their first instruction instead of
being lowered just after they start.
