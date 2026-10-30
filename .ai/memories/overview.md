---
description:
  What Ork is, its packages and their dependency direction, and where each kind
  of knowledge lives. Read first.
last-verified: 2026-10-30 (commit 924b06b)
---

# Ork overview

Ork is a local, open-source orchestration harness for Claude agents: workflows
of hierarchical agent and tool nodes, designed in a CLI or a localhost UI, saved
as git-friendly YAML, and run on the user's machine with the user's own
accounts. Ork never handles credentials
([ADR-004](../../decisions/ADR-004-no-credentials.md)).

## Packages

Dependency direction, enforced by `oxlint.config.ts`:
`schema <- core <- runtime-claude, nodes <- server <- cli`.

| Package                      | Folder                    | Role                                                                    |
| ---------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `@krapht/ork-schema`         | `packages/schema`         | Workflow file format: Zod model, JSON Schema, canonical YAML            |
| `@krapht/ork-core`           | `packages/core`           | Expressions, graph compiler, runtime port, session planning, the engine |
| `@krapht/ork-runtime-claude` | `packages/runtime-claude` | Claude drivers: Agent SDK and headless `claude` CLI                     |
| `@krapht/ork-nodes`          | `packages/nodes`          | Built-in node types: Claude, tool and gate executors                    |
| `@krapht/ork-server`         | `packages/server`         | Local HTTP + SSE API for the UI (milestone 2)                           |
| `@krapht/ork`                | `packages/cli`            | The `ork` command; the only published package, bundling the others      |

Status per area: [specs/README.md](../../specs/README.md). Release route:
[ADR-015](../../decisions/ADR-015-changesets-and-one-bundled-cli.md).

## Where things live

| Topic                                        | Location                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Contracts for current and specified behavior | [`specs/`](../../specs/README.md)                                          |
| Overview, milestones                         | [`docs/design.md`](../../docs/design.md)                                   |
| How the parts interact, with status          | [`docs/interaction-map/`](../../docs/interaction-map/README.md)            |
| Accepted decisions                           | [`decisions/`](../../decisions/README.md)                                  |
| Proposals                                    | [`rfcs/`](../../rfcs/README.md)                                            |
| Procedures (docs, release)                   | [`runbook/`](../../runbook/development/docs.md)                            |
| Conventions and commands                     | [`AGENTS.md`](../../AGENTS.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| Local task specs (gitignored)                | `.ai/specs/`                                                               |
