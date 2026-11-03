---
"@krapht/ork": patch
---

Add `timeout` to tool and Claude nodes, `defaults` and `limits`, such as
`timeout: 30m`. Time spent waiting on you doesn't count. A node that runs out
fails with `timedOut` in its output, and a run ends as `timed_out`.

`ork stop`, Ctrl-C and a timeout now end a tool node's command and whatever it
started, even if they ignore SIGTERM. Before, they could keep running.
