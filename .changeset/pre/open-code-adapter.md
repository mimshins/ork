---
"@krapht/ork": patch
---

Add the `open-code` driver's adapter: sessions run the user's own
`opencode run --standalone --format json` in the node's worktree, with Ork's
tools, the permission rules (deny by default) and a dedicated agent in a config
file written at mode 0600 outside the checkout and removed after the session.
The machine's and the project's OpenCode config stay out. The driver stays
unproven, so `ork validate` and `ork run` still refuse it until a real session
proves it.
