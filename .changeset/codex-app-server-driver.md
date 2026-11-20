---
"@krapht/ork": minor
---

Add `codex-app-server`, the sixth agent driver: it runs your own `codex` as
`codex app-server` and talks to it in both directions. A message to a node
(`ork chat`, `ork send`) reaches the model before the turn ends, `ork stop`
interrupts the turn, and Codex's questions about a command or file change come
to you in `ork decide`, answered once and never for the session. The `codex`
driver is unchanged. It is built and **not yet proven**: `ork validate` and
`ork run` refuse a node on it, and `ork doctor` shows it as `skip`, until a
capped run on a real `codex` passes. Your own Codex `config.toml` and
execution-policy rules still load on it, Ork's hook and sandbox still hold the
node, and a hooks file of yours stops the node before it starts. The README, the
docs overview, `ork --help` and the npm description now name six drivers. Two
`omp` fixes ride along: a message sent while a deferral aborts the turn is no
longer lost, and approvals are paired by call order.
