---
"@krapht/ork": minor
---

`claude.subagent` nodes now run: each is passed to its parent's session as a
Claude Code subagent (the SDK's `agents`, the CLI's `--agents`), with its role,
instructions and prompt as its system prompt, its description saying when to use
it, and its model, turns and tool limits carried over.
