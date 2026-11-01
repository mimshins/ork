---
"@krapht/ork": minor
---

`ork resume` now continues the Claude session of a node that was cut off
mid-session (the run was stopped, crashed or ran out of budget), instead of
starting it over; a node that failed in a failed run still starts fresh.
