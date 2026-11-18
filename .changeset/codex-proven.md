---
"@krapht/ork": minor
---

The `codex` driver is proven on a real session: `ork doctor` shows it `ok` once
`codex` is signed in, and `ork validate` and `ork run` take a node that names it
(a run that names no driver still prefers `claude-code`). It reports tokens and
no dollars, so cap it with `budgetTokens`; a node that needs `maxTurns`, its own
`mcp` servers, sub-agents or a path-scoped read deny is still refused, and so
are `ork onboard` and `ork:security-audit`, whose workflows set `maxTurns`.
