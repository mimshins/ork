# ADR-074 — Neutral names for the runtime port and its package

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** runtime
- **Amends:** [ADR-005](./ADR-005-one-runtime-port-two-drivers.md) (its names,
  not its decision)
- **RFC:** [RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md), open
  question 4, decided by the maintainer

## Context

[ADR-005](./ADR-005-one-runtime-port-two-drivers.md) put a runtime port in the
engine, `ClaudeRuntime`, implemented by `@krapht/ork-runtime-claude`, with
driver descriptors `ClaudeDriver` in `CLAUDE_DRIVERS`. RFC-014 runs other agent
CLIs (OpenCode, Command Code) behind the same port, so names that say "Claude"
would be wrong for every driver but one. No file a user writes names them, so
the rename can land on its own, before the first new adapter, with no change in
behavior.

## Decision

| Was                          | Now                   |
| ---------------------------- | --------------------- |
| `ClaudeRuntime` (the port)   | `AgentRuntime`        |
| `ClaudeDriver` (descriptor)  | `AgentDriver`         |
| `CLAUDE_DRIVERS`             | `AGENT_DRIVERS`       |
| `@krapht/ork-runtime-claude` | `@krapht/ork-runtime` |
| `packages/runtime-claude/`   | `packages/runtime/`   |

The dependency direction is unchanged under the new name:
`integrations <- schema <- core <- runtime, nodes <- server <- ui, cli`
(`oxlint.config.ts`). The port's shape, the driver ids (`sdk`, `cli`) and every
behavior stay as they were; RFC-014's later changes alter those.

## Options considered

- **Keep the Claude names.** No churn, and every new driver would sit behind a
  port named for another tool.
- **Rename together with the first new adapter.** One change fewer, and a
  mechanical rename mixed into a behavior change is hard to review.
- **Rename first, alone** — chosen by the maintainer.

## Rationale

The names should say what the code is: one port for any agent CLI. A separate,
mechanical change keeps the diff reviewable and leaves nothing to resolve when
the adapters land.

## Consequences

- Historical ADRs and RFCs keep the old names as the record; their links point
  at the new folder.
- Only `@krapht/ork` is published, and it bundles the runtime package, so no
  user-visible name or import changes.
