---
"@krapht/ork": minor
---

`ork ui` has its Logs and Decisions panels. Logs shows a run's events live,
filtered by node, type or text, holds its place when you scroll up, and reads
older events a page at a time. Decisions lists every open question across runs,
with the recommended option standing out: answer with a click or the keys `1` to
`9`, and see who answered one that was settled elsewhere. The server gains
`GET /api/decisions/:id`.
