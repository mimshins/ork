---
"@krapht/ork": minor
---

The Agent SDK driver is gone; Ork runs agents through their CLIs (RFC-014). The
driver ids are now `claude-code`, `open-code` and `command-code`. `claude-code`
runs your own `claude` and is ready when it is logged in, or when
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1` is set;
`ork doctor` says which. `open-code` and `command-code` are listed, and refused
until a real session has proven them. A workflow, `.ork/project.yaml` or
`--driver` naming `sdk` or `cli` is refused with a message naming `claude-code`;
runs recorded with them still resume, read as `claude-code`. The published
package no longer depends on `@anthropic-ai/claude-agent-sdk` or
`@anthropic-ai/sdk`.
