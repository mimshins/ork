---
"@krapht/ork": minor
---

Deterministic steps can now tell a working session what happened with no model
turn. A program in a tool node writes with `ork send <to> -m <body>` or
`--stdin`, and a node's `notify:` declares a message to send when it finishes.
Both land as a notice and `read_inbox`, labelled `via`, and show in `ork logs`
and the Logs and Chats panels. A channel can now have a tool node on one side,
one way. The extra turn that reads a late message now stays within what's left
of the budgets, and can no longer fail a node that already reported.
