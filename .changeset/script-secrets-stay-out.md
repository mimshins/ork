---
"@krapht/ork": patch
---

Secrets read through `{{env.NAME}}` no longer reach the store in a JSON parse
error, in JSON keys or numbers, in any form a JSON encoder writes them, line by
line, as the values of a JSON secret, or from a later node or a called run that
prints them. A node's new `plainEnv` lists variables that are not secret, so a
region isn't masked. `$ORK_OUTPUT` and `$ORK_RUN_DIR` now point at the run's
real folder. `ork decide` and `ork continue` refuse from a program or an agent
in a run, and `ork ui` withholds its sign-in link there. A variable a called
workflow needs gets a warning at the start, and the call fails if reached.
SIGTERM and SIGHUP stop a run as Ctrl-C does.
