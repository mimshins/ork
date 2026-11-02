---
"@krapht/ork": minor
---

Pause, continue, and stop one node. `ork pause [run] [--node n]` pauses a live
run, or one of its nodes, without cutting anything short: nothing new starts, a
running session finishes its step and waits before its next tool call, and a
gate's timeout waits too. `ork continue` lets it go on from where it waited,
even after a long pause. `ork stop --node n` stops one running node: it fails,
"stopped by the user", and the rest of the run goes on. `ork ps` shows a paused
run as `paused`, and `ork tree` marks the nodes that are waiting. The local
server has the same as `POST /api/runs/:id/pause`, `/continue` and `/stop` (each
with `{ node? }`), and lists a project's workflows at
`GET /api/projects/:id/workflows`.
