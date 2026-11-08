---
"@krapht/ork": minor
---

Ask your agent to set Ork up for you. A new skill, `/ork:setup` in Ork's Claude
Code plugin and `/ork-setup` through `ork init --skills`, checks `ork` and
`ork doctor`, sets the project up with `ork init` or `ork register`, makes Ork's
tools available to the agent, and offers a first workflow, asking before it
installs anything, edits a config or starts a run. It never asks for a
credential and never answers a decision. `ork doctor` says when a project's copy
is older than Ork, as for the other skills. A new getting-started page, With
your agent, shows how with Claude Code, any MCP client through `ork mcp`, and an
agent that only has a shell.
