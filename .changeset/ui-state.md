---
"@krapht/ork": patch
---

`ork ui` now follows the server live: its status bar shows the runs and
decisions in play, says why when it cannot reach the server, and recovers by
itself when the server returns. The command palette sets the theme and the
density, and your browser remembers them. The events API takes `?last=` for a
run's newest events.
