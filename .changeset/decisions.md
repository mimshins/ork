---
"@krapht/ork": minor
---

Questions now wait in one place. Every `ask_user` call, permission prompt, gate
and exhausted loop is a decision in the store, answered on the run's own
terminal or with the new `ork decide` from any other terminal, whichever comes
first. New: `ork stop` stops a live run from anywhere, and `ork run --detach`
runs in the background (its questions wait for `ork decide`). Each live run
listens on a local socket, `~/.ork/sockets/<run>.sock`, so answers and `stop`
reach it at once and `ork logs --follow` streams its events as they happen.
