---
"@krapht/ork": patch
---

A leader's claims no longer block its own children. When `delegate` or
`spawn_worker` starts work, Ork releases what the leader holds, so a child can
claim those paths, and the result tells the leader to claim again before it
edits. Children still contend with each other and with nodes outside the team.
