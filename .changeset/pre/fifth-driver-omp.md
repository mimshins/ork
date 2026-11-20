---
"@krapht/ork": minor
---

Add `omp`, the fifth agent driver: it runs your own `omp` (the CLI of oh-my-pi)
headless, one process for each stretch of a session, with Ork's tools through a
private plugin and a guard Ork writes to hold each node to its rules and to hold
a paused node's next call. It is built and **not yet proven**: `ork validate`
and `ork run` refuse a node on it, and `ork doctor` shows it as `skip`, until a
capped run on a real `omp` passes. `ork doctor` reads `omp models --json` and
shows the number of models your logins reach. Session files go to
`~/.ork/omp/sessions/` and a small ledger of what each session spent to
`~/.ork/omp/spent/`; Ork never prunes either. The README, the docs overview,
`ork --help` and the npm description now name Codex and `omp` beside Claude
Code, OpenCode and Command Code.
