---
description:
  What Ork is, its packages and their dependency direction, and where each kind
  of knowledge lives. Read first.
last-verified: 2026-11-09 (commit f93117d and its working tree)
---

# Ork overview

Ork is a local, open-source orchestration harness for Claude agents: workflows
of hierarchical agent and tool nodes, designed in a CLI or a localhost UI, saved
as git-friendly YAML, and run on the user's machine with the user's own
accounts. Ork never handles credentials
([ADR-004](../../decisions/ADR-004-no-credentials.md)).

## Packages

Dependency direction, enforced by `oxlint.config.ts`:
`integrations <- schema <- core <- runtime, nodes <- server <- ui, cli`.

| Package                    | Folder                  | Role                                                                               |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `@krapht/ork-integrations` | `packages/integrations` | Registries of tool integrations and agent drivers (adapters)                       |
| `@krapht/ork-schema`       | `packages/schema`       | Workflow file format: Zod model, JSON Schema, canonical YAML                       |
| `@krapht/ork-core`         | `packages/core`         | Expressions, graph compiler, runtime port, session planning, the engine            |
| `@krapht/ork-runtime`      | `packages/runtime`      | Agent drivers as CLI adapters: `claude-code`; `open-code`, `command-code` unproven |
| `@krapht/ork-nodes`        | `packages/nodes`        | Built-in node types: Claude, tool, gate and call executors                         |
| `@krapht/ork-server`       | `packages/server`       | `ork ui`'s HTTP + SSE API (ADR-039) and `ork mcp`'s tools (ADR-057)                |
| `@krapht/ork-ui`           | `packages/ui`           | The browser UI `ork ui` serves (ADR-040); built into the CLI's `dist/ui`           |
| `@krapht/ork`              | `packages/cli`          | The `ork` command; the only published package, bundling the others                 |

Status per area: [specs/README.md](../../specs/README.md). Release route:
[ADR-015](../../decisions/ADR-015-changesets-and-one-bundled-cli.md).

## Where things live

| Topic                                        | Location                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Contracts for current and specified behavior | [`specs/`](../../specs/README.md)                                          |
| Overview, milestones                         | [`specs/design.md`](../../specs/design.md)                                 |
| How the parts interact, with status          | [`docs/interaction-map/`](../../docs/interaction-map/README.md)            |
| Accepted decisions                           | [`decisions/`](../../decisions/README.md)                                  |
| Proposals                                    | [`rfcs/`](../../rfcs/README.md)                                            |
| Procedures (docs, release)                   | [`runbook/`](../../runbook/development/docs.md)                            |
| Conventions and commands                     | [`AGENTS.md`](../../AGENTS.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| Local plans (gitignored)                     | `.ai/plans/`                                                               |
