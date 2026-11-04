# ADR-049 — Deterministic steps around a session, MCP calls and inline scripts

- **Status:** Accepted
- **Date:** 2026-11-04
- **Topic:** workflow format / node types / dependencies
- **RFC:** [RFC-006](../rfcs/archived/RFC-006-steps-around-a-session.md)
- **Builds on:** [ADR-047](./ADR-047-script-identity-env-json.md) (a program's
  identity), [ADR-048](./ADR-048-scripts-and-rules-on-the-bus.md),
  [ADR-011](./ADR-011-in-house-mcp-server.md) (the MCP SDK)

## Context

A session's report was taken on its word. A tool node can't reach a worker's
worktree or a delegated child, so setting one up or checking it took a model
turn. So did calling a known MCP tool. A short script meant quoting `sh -c` in
YAML, which invites templating a value into shell.

## Decision

**A step has one shape:** `command` or `script`, `env`, `plainEnv`, `output` and
`timeout`, as a tool node's program. It runs through the tool nodes' executor,
in the node's checkout, as the node.

**`verify:` on leaders and workers,** after a report that is not `fail` or
`changes_requested`, and before the node's work is committed. On a failure the
same session resumes with the reason and the last 8 KiB of the output, up to
`attempts` times (default 1), within what is left of the budgets; then the node
fails. A failed check stays failed whatever the session then reports, because a
real run showed a session reporting `changes_requested` after a failure, and the
run ending green. The session's instructions name the check, so it can run it
first.

**`before:` on leaders and workers, and under `defaults:`,** in the node's
checkout before its session. A failure spends no model turn. Its prompt reads
the result as `{{before.*}}`.

**`script:` on `tool.shell` and steps,** with no templates in it, so a value
can't become code: values arrive through `env:`. It runs under `sh -eu`, or the
`interpreter:` it names, from the run's private folder.

**`mcp.call`, a node for one named tool,** on a server from the project's
`.mcp.json`, stdio or HTTP with static headers. Secrets stay in the user's
environment, and each value read is masked. OAuth and SSE servers are refused. A
run checks its servers before it starts. `@modelcontextprotocol/sdk`, already a
runtime dependency of `runtime-claude` and the CLI, is now one of `nodes` too,
at the same version.

## Options considered

From RFC-006, in full there:

- **`verify:`:** denying the report with a hook inside the session (two drivers,
  and managed settings can stop a hook, which would pass a report unchecked);
  only failing the node (a delegated child has no edges to retry on).
- **Hooks:** `after:` (nobody has asked, and a stop, a timeout and a crash each
  need an answer); lifecycle hooks in project rules (far from the node, and
  named points become a contract).
- **Scripts:** a `tool.script` node (a second node for one job, and steps need
  `script:` anyway); none (long `sh -c` strings).
- **MCP:** servers declared in the workflow (a second place to define one); a
  one-tool session (spends a turn); none.

## Consequences

- A session can't report success past a failing check, and a retry costs a
  resume rather than a new session.
- A broken setup fails before any model turn, and a program can gather what a
  session would spend turns finding.
- A check costs a turn only when it fails, and what goes back stays small.
- `command` is optional on `tool.shell`, with a compile check for exactly one of
  it and `script`; `schemaVersion` stays 1.
- `before` is a new root in templates, so a node's own field of that name needs
  `output.before`, with a warning.
- The root `tsconfig` now sets `skipLibCheck`, as the SDK's HTTP client
  declaration does not pass under `exactOptionalPropertyTypes`
  ([C8](../specs/gaps.md#chores)).
- Limits: [L93, L94 and L95](../specs/gaps/limits-scripts.md).
- `verify:` and `before:` were proven on a real session on the CLI driver,
  through a failing check that the same session then fixed. `mcp.call` was
  proven against real stdio and HTTP servers with no session. The SDK driver
  stays under C5.
