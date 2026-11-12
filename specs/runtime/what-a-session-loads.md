# What a session loads

_Part of [Runtime: the agent drivers](../runtime.md)._

Every Claude session of a run (workers, leaders, a leader's question fork)
starts **clean of the machine's Claude setup**
([claude-code.ts](../../packages/runtime/src/adapters/claude-code.ts),
[tests](../../packages/runtime/test/clean.test.ts), ADR-065):

- **The repository's setup loads**: `settingSources` stays `project`, `local`,
  so `CLAUDE.md`, `AGENTS.md` and `.claude/`'s agents, skills and settings load,
  with Ork's own plugins and context. User-level `~/.claude` settings never do.
- **No MCP server but Ork's**: `--strict-mcp-config`, so neither
  `~/.claude.json`'s servers, nor those registered for the folder, nor a
  project's `.mcp.json` or plugins' servers load. Their set changing mid-session
  rewrote the prompt cache: the same 4-turn task on `claude` 2.1.319 cost $0.113
  loose and $0.032 strict. The servers a node names load too (below).
- **No auto-memory**: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the session's
  environment, so the machine user's notes under
  `~/.claude/projects/<folder>/memory/` stay out.
- **The per-machine prompt sections leave the cached prefix**:
  `--exclude-dynamic-system-prompt-sections` moves the working directory, memory
  path and git status into the first user message. It changes no content, so it
  stays on either way.

**`ork run --machine-claude`** turns the first two back: the run's sessions load
the machine's MCP servers and auto-memory as `claude` would. The run records it
once (`settings.machineClaude` on `run.started`, beside `readyDriver`), and
`ork resume`, `ork chat` and every run it calls (`workflow.call`, which starts
`ork run --machine-claude`) keep it; `ork resume` takes no flag of its own. A
run recorded before it resumes clean. `--node` takes it too. The Run workflow
form's "Use this machine's Claude setup" box adds it ([server](../server.md)). A
leader's question fork stays strict either way: it sets `strictMcp` itself
([leader questions](../messaging/leader-questions.md)).

**A node names the servers it needs** (`mcp:` on a leader, a worker or
`defaults`, [ADR-067](../../decisions/ADR-067-nodes-name-mcp-servers.md),
[tests](../../packages/runtime/test/mcp-servers.test.ts)). `SessionSpec`'s
`mcpServers` holds those entries of the project's `.mcp.json`, as written, and
the driver adds them beside Ork's in `--mcp-config`. Strict stays on, so nothing
else loads. Naming a server adds `mcp__<name>` to the node's allow list (deny
rules win). `${VAR}` stays text: `claude` expands it. The sessions the CLI
starts itself (`ork run --node`, `ork chat`) load them too. A leader's question
fork loads none.
