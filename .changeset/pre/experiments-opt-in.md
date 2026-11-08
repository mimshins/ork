---
"@krapht/ork": minor
---

Experimental features can ship on `main` turned off. `experimental: [<name>]` in
`project.yaml` or `ORK_EXPERIMENTAL=<name>[,<name>…]` turns one on, `ork doctor`
lists what is on and who turned it on, and a name Ork doesn't know fails
`ork validate`, `ork run` and that doctor check. No experiment ships yet.
