---
"@krapht/ork": patch
---

Make a stop reach what waits for an answer. `ork stop`, `ork stop --node`,
Ctrl-C and SIGTERM now end the wait on a list over `maxItems`, in a detached run
too. Stopping a node or one item withdraws the question or permission prompt it
left open, instead of leaving it in `ork decide`. Ctrl-C at a question's prompt
now interrupts the run; readline used to swallow it.
