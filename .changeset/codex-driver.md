---
"@krapht/ork": minor
---

Add the `codex` driver, built but not proven yet: it runs your own OpenAI
`codex exec` per leg, with Ork's tools, a sandbox and a per-session hook that
holds the node's tool rules. `ork doctor` shows it as `skip` and `ork run`
refuses a node that names it until it has run on a real session.
