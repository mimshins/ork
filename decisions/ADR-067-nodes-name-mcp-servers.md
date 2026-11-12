# ADR-067 — A node names the MCP servers it needs

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** workflow format, runtime
- **RFC:** waived — the maintainer chose directly on 2026-11-08
- **Amends:** [ADR-065](./ADR-065-clean-claude-sessions.md) (what a session
  loads)

## Context

Since 1.0.0-alpha.1 a session loads no MCP server but Ork's unless the whole run
takes `--machine-claude` ([ADR-065](./ADR-065-clean-claude-sessions.md)). The
ui-designer, a11y-auditor and qa agents open a browser, so they had none, and
`--machine-claude` brings back every server, connector and memory, plus the
cache rewrites that sank the first `feature` run.

## Decision

1. A `claude.leader`, a `claude.worker`, and a workflow's or project's
   `defaults` take `mcp: [name]`. A node's list wins over `defaults` as a whole
   (`mcp: []` turns the defaults off); workflow defaults win over the project's,
   key by key. A sub-agent runs in its parent's session and takes none. Agents
   take none either, so the list stays visible in the workflow file.
2. Servers are defined in the project's committed `.mcp.json`, Claude Code's
   format, the file `mcp.call` already reads. One definition serves `claude`,
   `mcp.call` and sessions.
3. Only the named servers load, beside Ork's own, still under
   `--strict-mcp-config`. A server no node names doesn't load. A leader's
   question fork loads none. Under `--machine-claude` strict is off, so named
   servers are added to the machine's.
4. Naming a server allows its tools: it adds `mcp__<name>` to the node's allow
   list, and deny rules still win, because a headless node can't answer per
   call.
5. A name `.mcp.json` lacks is an `mcp.unknown` error, `ork` is `mcp.reserved`,
   and a malformed entry is `mcp.malformed`, from the compiler, so
   `ork validate`, `ork run`, the server's check and `ork mcp`'s `check` all
   agree.
6. Entries reach the driver as written. Ork expands no `${VAR}` for a session:
   the SDK driver hands them to the same `claude`, as `--mcp-config`, and
   `claude` expands them. No definition value enters `SessionSpec` events, logs
   or `ork context explain`.

The format change is additive and `schemaVersion` stays 1.

## Options considered

- **`--machine-claude` for UI runs.** Loads every server and memory for every
  node, with the cache rewrites ADR-065 removed.
- **A Playwright browser through Bash.** Heavier, no tool schema, and more Bash
  permissions per node.
- **A per-run `--mcp` flag.** Not per node, so other nodes would get the server
  and pay for its tool list.
- **A `mcpServers:` block in `project.yaml`.** Duplicates Claude Code's format
  and splits the definition from `mcp.call`'s.

## Rationale

Per-node naming gives a browser to the nodes that use one and keeps every other
session clean. A fixed set per node is stable within a session, so ADR-065's
cache win stays; a node with a heavy server pays that server's tool list, and
only that node. The list sits in the committed workflow file, so a change shows
in review.

## Consequences

- **`.mcp.json` applies repo-wide.** This repository now commits `.mcp.json`
  with `chrome-devtools` (`npx`, exact version 1.12.0, `--isolated`, no
  credential). It also loads in a maintainer's own interactive `claude` session
  here, which asks once to approve a project server. That is wanted: one
  definition serves both.
- Naming a server lets that node's session run the server's program on the
  user's machine. Secrets stay in the user's environment (`${VAR}`) or the
  server's own login; Ork holds none, and an OAuth server is allowed for a
  session because its tokens are Claude Code's. `mcp.call` still refuses OAuth.
- `.mcp.json`'s reader moved to `@krapht/ork-core` so `checkWorkflowText`, the
  compiler's one caller, can read it; `@krapht/ork-nodes` reuses it.
- The pre-flight "program not installed" check covers `mcp.call` servers only; a
  session server that fails to start fails as Claude reports it
  ([G15](../specs/gaps.md)). A typo in `.mcp.json` breaks `mcp.call` and
  sessions alike, with the same message.

## Specs

[runtime.md](../specs/runtime/what-a-session-loads.md),
[workflow-format.md](../specs/workflow-format.md),
[project-rules.md](../specs/project-rules.md),
[graph-compiler.md](../specs/graph-compiler.md).
