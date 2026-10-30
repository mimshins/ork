---
"@krapht/ork": minor
---

Nodes in a run can now message each other. `send_message` reaches a node's
owner, the nodes it owns and the nodes it shares a `messages` channel with; the
recipient gets a one-line notice at its next step, even mid-task, and reads the
message with `read_inbox`. When a loop runs out of rounds while the leader that
owns it is still working, Ork asks that leader (it replies with `answer`)
instead of you; if its session ends first, the question comes to you as before.
`ork logs` shows messages and these questions.
