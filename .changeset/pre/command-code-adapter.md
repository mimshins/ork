---
"@krapht/ork": patch
---

Add the `command-code` adapter: a session runs the user's own `cmd -p` in JSON
mode, reaches Ork's tools through the checkout's leased `ork` MCP entry, hands
its report in through Ork's `report` tool, and is held to its node's tool rules
by a session mod that refuses everything the node did not allow. The driver
stays unproven, and refused, until a real session proves it.
