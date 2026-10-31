---
"@krapht/ork": minor
---

New: agents. Define who does the work once and give it to any Claude node with
`agent: <name>`; the node's `prompt` is its task, and anything set on the node
wins. Agents come from `~/.ork/agents`, your project's `.claude/agents`,
`.opencode/agents`, `.ai/agents` and `.ork/agents` (linked folders counted
once), or a workflow's own `agents:` section. An agent is a portable `<name>.md`
plus an optional `<name>.agent.yaml` with Ork's settings.
`ork agents list | show | add | rm` manages them, `ork context explain` names
the agent that fills a node, and both examples now use agents.
