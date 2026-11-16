---
"@krapht/ork": patch
---

A child's `send_message` to a leader that is waiting on it in `delegate` or
`spawn_worker` is refused, with a note to ask with `ask_user` or decide, instead
of leaving the child waiting for a reply that can't come.
