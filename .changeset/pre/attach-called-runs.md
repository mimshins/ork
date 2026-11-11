---
"@krapht/ork": minor
---

`ork attach <run>` follows a run and every run it called, at any depth, and asks
their open questions on your terminal; Ctrl-C detaches and leaves the run going.
A foreground `ork run` that calls workflows now does the same for the runs it
calls, so a called run's gate (such as `start`'s plan) is answered in the
terminal that started it. `ork run --detach` points to `ork attach` first.
