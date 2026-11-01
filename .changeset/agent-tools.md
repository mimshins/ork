---
"@krapht/ork": minor
---

An agent's Claude Code frontmatter `tools:` and `disallowedTools:` are now
read: `tools: Read, Grep` leaves the node only those built-in tools (new
`tools.only`, also settable on a node or in the agent's settings file), and
Ork's own tools stay available.
