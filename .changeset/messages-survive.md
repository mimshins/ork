---
"@krapht/ork": minor
---

Messages are no longer lost: `ork resume` rebuilds each node's unread messages
and your queued `ork chat` messages from the run's events, and a node whose
session ends with an unread message (one that came in as it wrote its report)
gets one more turn to read it and report again.
