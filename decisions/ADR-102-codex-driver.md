# ADR-102 — The `codex` driver: OpenAI's `codex` CLI as the fourth driver

- **Status:** Accepted
- **Date:** 2026-11-18
- **Topic:** runtime
- **RFC:** [RFC-024](../rfcs/archived/RFC-024-codex-driver.md)

## Context

[ADR-076](./ADR-076-cli-drivers-only.md) made every driver a tool's CLI behind
one session runner, with a descriptor of declared capabilities. OpenAI's `codex`
CLI is the next tool people already sign in to
([ADR-004](./ADR-004-no-credentials.md)). Its `codex exec --json` runs one turn
a process and has no per-call permission prompt in `exec`, so a node's rules
need another wall. RFC-024's spike measured the flags, the hook and the event
lines on `codex-cli` 0.169.0.

## Decision

- **One process per leg.** Each leg is `codex exec --json` in the node's
  worktree. A later message or answer waits for the leg's end and runs
  `exec resume <id>`; a leader's question fork runs `exec fork <id>`. No
  `codex app-server`, no mid-turn messages, no Ork-answered approvals (a later
  RFC).
- **Ork's tools over `-c`.** `mcp_servers.ork.*` keys carry the endpoint; the
  bearer token is in the leg's environment only (`bearer_token_env_var`), never
  on argv or in a file. The node's own `.mcp.json` servers are not given to
  Codex.
- **Deny by default, fail closed.** The outer wall is the sandbox (`read-only`
  or `workspace-write`, never wider, `--yolo` included). The node's rules are a
  per-session `PreToolUse` hook Ork writes in a private folder outside the
  checkout and runs with `--dangerously-bypass-hook-trust`. The node refuses to
  start, before any model call, when a user or system `hooks.json` exists (Ork
  checks existence only); a leg that ran tool calls without the hook ends the
  node with a driver error.
- **A clean session by flags.** `--ignore-user-config`, `--ignore-rules` and
  `--disable` for plugins, apps and remote plugins, with every Ork setting as
  `-c`; no profile, no `--ephemeral`, never `--skip-git-repo-check`.
- **Tokens only; Codex's default model.** `price: false` (`budgetTokens` binds,
  `budgetUsd` alone is warned); `-m` only when the node names a model after the
  `codex.` prefix.
- **Capabilities.** `questions: true`; `permissionPrompt`, `price`,
  `midTurnMessages`, `reportSchema`, `turnLimit`, `mcpServers` and `subagents`
  are `false`, so `ork validate` refuses a node that needs them. New capability
  **`readDenies`** (`true` for the other three drivers, `false` for `codex`): a
  `deny` rule scoped to a path on `Read`, `Glob` or `Grep` is refused for a
  driver without it, because Codex has no read tool for the hook to gate.
  `driver-needs` reads the descriptor, never a driver id.
- **One rule matcher.** The hook's script and `command-code`'s mod take the same
  rule matcher from
  [tool-rules-source.ts](../packages/runtime/src/tools/tool-rules-source.ts),
  parameterised by tool names, read tools and meta tools, not copied.
- **`proven: false`.** `ork doctor` shows `skip`, `readyDriver` never takes it,
  and `ork validate` refuses a node that names it, until the maintainer's capped
  run on a real `codex` sets `proven: true`.
- **Deferred.** No `hold` (hold forwarding, `heavy` slots and mid-turn pause for
  Codex calls), `--output-schema`, Codex Cloud, the desktop app and
  `codex review` as a node type; each is in
  [the register](../specs/gaps/codex-limits.md).

The RFC was accepted as written; no waiver. Contract:
[the `codex` driver](../specs/runtime/codex.md).

## Options considered

Weighed in RFC-024: sandbox only (refuses nodes whose rules a sandbox can't
hold), a hook with the sandbox (chosen), `codex app-server`, `-p` profiles and
`--ephemeral` against flags on every leg, and `--output-schema` against Ork's
`report` tool.

## Rationale

The sandbox alone cannot hold a node's `deny` and `only` rules, and a hook can;
the two together keep a node inside its rules without Ork widening a wall. A
hook Ork cannot confirm ran is not relied on, so the driver fails closed rather
than run unguarded. A capability for read denies keeps the refusal generic
(ADR-076) rather than a driver id in shared code.

## Consequences

- Extends ADR-076's driver list; adds `readDenies` to the descriptor
  ([runtime spec](../specs/runtime.md)).
- First unguarded calls of a leg run inside the sandbox before the missing hook
  is noticed; recorded in the spec.
- Gaps recorded in [the register](../specs/gaps/codex-limits.md): reads outside
  the worktree, skills and sessions kept in the user's Codex home, user and
  system hooks refusing the node, `OPENAI_API_KEY` not counted, no hold.
- Follow-ups after merge: the gate run that sets `proven`, `--output-schema`
  measured against Ork's report schemas, a node outside a git repository and one
  with its own `.mcp.json` servers, and an RFC for `codex app-server`.
