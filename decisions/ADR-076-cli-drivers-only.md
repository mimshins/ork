# ADR-076 — CLI drivers only: claude-code, open-code, command-code

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** runtime
- **RFC:** [RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md)

## Context

[ADR-005](./ADR-005-one-runtime-port-two-drivers.md) gave the runtime port two
Claude drivers, `cli` and `sdk`. The Agent SDK driver tied Ork to one vendor's
package, and each new agent tool (OpenCode, Command Code) would have meant a
branch in shared code.

## Decision

- The SDK driver and its dependencies are removed. Every driver runs a tool's
  CLI. The ids are `claude-code`, `open-code` and `command-code`; `sdk` and
  `cli` are refused with a message naming `claude-code`, and stored runs that
  record them are read as `claude-code` (files are never rewritten).
- A driver is a descriptor with declared `capabilities` and `proven`
  ([runtime spec](../specs/runtime.md)), plus an adapter built from small
  strategies (command, event decoder, MCP wiring, permissions, usage, context)
  behind one session runner. The contract suite runs against every adapter and
  its fake tool.
- `ork validate` and `ork run` refuse a node whose driver lacks what it needs,
  or is not yet proven, naming both. They read only the descriptor, never a
  driver id.
- Ork's `report` tool validates a report for drivers without a native schema.
- Command Code runs one session per checkout (a lease on its per-folder MCP
  entry); `open-code` and `command-code` deny by default. Details:
  [runtime spec](../specs/runtime.md),
  [OpenCode](../specs/runtime/open-code.md).
- `open-code` and `command-code` ship `proven: false` until a maintainer-run
  capped real session; the RFC closes with the code, and those gates follow.

## Options considered

A common denominator over all tools, protocol drivers (OpenCode server, ACP),
and keeping the SDK: weighed in the RFC.

## Rationale

CLIs are what users already log in to (ADR-004); an adapter per tool keeps the
engine free of tool names (ADR-022), and refusals before a run avoid wasted
spend (ADR-064).

## Consequences

- Supersedes the two-driver decision in ADR-005; touches
  [ADR-011](./ADR-011-in-house-mcp-server.md), ADR-064 and ADR-065.
- Gaps recorded in [gaps](../specs/gaps.md): single session per checkout, no
  mid-session permission prompts off `claude-code`, `budgetUsd` refused on
  no-price drivers until RFC-015.
