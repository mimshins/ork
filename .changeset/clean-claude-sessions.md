---
"@krapht/ork": minor
---

A run's Claude sessions start clean of the machine's Claude setup, on both
drivers: no MCP server but Ork's (`--strict-mcp-config`), Claude Code's
auto-memory off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), and the per-machine
system prompt sections out of the cached prefix
(`--exclude-dynamic-system-prompt-sections`). The repository's `CLAUDE.md`,
`AGENTS.md` and `.claude/` still load. A machine's MCP servers changing
mid-session made Claude rewrite its prompt cache: a measured 4-turn task cost
$0.113 before and $0.032 after. `ork run --machine-claude`, or "Use this
machine's Claude setup" in the Run workflow form, loads the machine's MCP
servers and memory for a run; the run records it, and `ork resume`, `ork chat`
and the runs it calls keep it.
