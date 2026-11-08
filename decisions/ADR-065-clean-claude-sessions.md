# ADR-065 — Claude sessions start clean of the machine's setup

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** runtime
- **RFC:** waived — the maintainer chose directly on 2026-11-08, after the first
  measured `feature` run
- **Amends:** [ADR-005](./ADR-005-one-runtime-port-two-drivers.md) (what a
  driver's session loads)

## Context

The first measured `feature` run (7b3abc09) failed: its spec-writer spent its $2
in 4 turns, writing 137k prompt-cache tokens and reading 11k. Every Ork session
loaded the machine's MCP servers (`~/.claude.json`'s, and those registered for
the folder), because the drivers passed Ork's server with `--mcp-config` but not
`--strict-mcp-config`. That set changes during a session (a server fails,
reconnects; `commands_changed`), and each change rewrites the cache. Measured
with Ork's flags on `claude` 2.1.319, the same 4-turn task cost $0.113 loose and
$0.032 with `--strict-mcp-config`: after turn 1, about 120 tokens written per
turn instead of 5–12k.

Sessions also loaded Claude Code's auto-memory for the folder
(`~/.claude/projects/<folder>/memory/`): the machine user's own notes, which a
run shouldn't see. Ork already left user-level settings out
(`--setting-sources project,local`).

## Decision

1. **Clean by default.** Every Claude session of a run (workers, leaders, forks,
   on both drivers) loads no MCP server but Ork's (`--strict-mcp-config`, the
   SDK's `strictMcpConfig: true`), runs with
   `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, and passes
   `--exclude-dynamic-system-prompt-sections` (the SDK's
   `excludeDynamicSections: true`), so the per-machine sections leave the cached
   prefix. The repository's own setup still loads (`project`, `local`).
2. **One switch per run.** `ork run --machine-claude` (the UI's "Use this
   machine's Claude setup") brings back the machine's MCP servers and
   auto-memory together; the dynamic-sections flag stays, since it changes no
   content.
3. **Recorded with the run.** It is `settings.machineClaude` on `run.started`,
   beside `readyDriver` ([ADR-064](./ADR-064-driver-chosen-at-run-time.md)), and
   `ork resume`, `ork chat` and the runs it calls keep it. A leader's question
   fork stays strict either way ([ADR-063](./ADR-063-leader-questions.md)).

The detail is in the [runtime spec](../specs/runtime.md#what-a-session-loads).

## Options considered

- **Keep loading everything:** what `claude` does, and what the run above paid
  for: a moving MCP set rewrites the cache, and the user's notes reach the run.
- **Only strict MCP:** fixes the cost, but leaves the machine user's memory in
  every session.
- **Clean by default, one run switch** — chosen: the cheap, private session is
  the default, and one switch brings the machine's setup back for a run that
  needs a server the project doesn't name.
- **Two switches** (MCP servers, memory): finer, but each is one more thing to
  record, carry to called runs and show in the UI, for a choice nobody has asked
  to split.
- **A project rule:** fits "mechanism, not policy", but the need is per run (a
  run that needs a browser server), and a rule would still need a run switch.

## Consequences

- A node can't use an MCP server from the machine's setup without
  `--machine-claude`, which loads all of them; naming servers for a node or a
  project is a gap ([gaps](../specs/gaps.md), G26).
- With `--machine-claude` the cache can be rewritten again when the machine's
  servers change; the person chose that for the run.
- A run recorded before this resumes clean.
