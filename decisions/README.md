# Decisions (ADRs)

Architecture Decision Records: accepted, durable decisions and why they were
made. They are project knowledge and stand on their own without any AI tooling.

## Conventions

- **Location:** `decisions/`
- **Naming:** `ADR-NNN-<kebab-case-title>.md`; the next free number, never
  reused.
- **Sections:** Context, Decision, Options considered, Rationale, Consequences.
  Metadata: Status, Date, Topic, RFC (or "waived" with the reason).
- **Self-contained:** a reader with only the ADR understands the decision and
  why. Link to [specs](../specs/README.md) and code for detail; do not restate
  them.
- **Immutable once accepted:** a later decision supersedes an ADR with a new
  ADR; the old one only gains `Status: Superseded by ADR-NNN`.
- **Atomic:** one decision per file. A long ADR gets a `## Contents` list, never
  a chunk folder ([docs structure](../runbook/development/docs.md)).

## When to write one

- An RFC ships: record its decision here and link both ways.
- A hard-to-reverse choice is made without an RFC: a new runtime dependency, a
  change to the workflow file format, a change to a layer rule or the dependency
  direction, a change to how Ork touches credentials or publishes.

Current and specified behavior belongs in [`specs/`](../specs/README.md);
proposals belong in [`rfcs/`](../rfcs/README.md).

## Index

| ADR                                                | Title                                                                       | Status            | RFC                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| [001](./ADR-001-spec-driven-development.md)        | Spec-driven development and the knowledge layout                            | Accepted          | waived                                                      |
| [002](./ADR-002-typescript-from-source.md)         | A TypeScript monorepo run from source, with supply-chain policies           | Accepted          | waived                                                      |
| [003](./ADR-003-oxlint-oxfmt-and-boundaries.md)    | oxlint and oxfmt, with package boundaries enforced by lint                  | Accepted          | waived                                                      |
| [004](./ADR-004-no-credentials.md)                 | Ork never handles credentials                                               | Accepted          | waived                                                      |
| [005](./ADR-005-one-runtime-port-two-drivers.md)   | One runtime port, two Claude drivers                                        | Accepted          | waived                                                      |
| [006](./ADR-006-workflow-file-format.md)           | The workflow file format                                                    | Accepted          | waived                                                      |
| [007](./ADR-007-safe-expression-language.md)       | A safe expression language for conditions and templates                     | Accepted          | waived                                                      |
| [008](./ADR-008-ownership-hierarchy.md)            | Ownership hierarchy rules                                                   | Accepted          | waived                                                      |
| [009](./ADR-009-worktree-per-writing-node.md)      | A git worktree per writing node                                             | Superseded by 020 | waived                                                      |
| [010](./ADR-010-reports-as-structured-output.md)   | Node reports as structured output                                           | Accepted          | waived                                                      |
| [011](./ADR-011-in-house-mcp-server.md)            | A minimal in-house MCP server for the CLI driver                            | Accepted          | waived                                                      |
| [012](./ADR-012-no-ai-attribution.md)              | No AI or agent attribution                                                  | Accepted          | waived                                                      |
| [013](./ADR-013-feedback-loop.md)                  | The feedback loop                                                           | Accepted          | waived                                                      |
| [014](./ADR-014-interaction-map.md)                | The interaction map as the onboarding and audit view                        | Accepted          | waived                                                      |
| [015](./ADR-015-changesets-and-one-bundled-cli.md) | Releases with changesets and one bundled CLI                                | Accepted          | waived                                                      |
| [016](./ADR-016-scheduler-semantics.md)            | How a workflow runs: activations, edges, dead paths and loops               | Accepted          | waived                                                      |
| [017](./ADR-017-blocking-delegate.md)              | Leaders delegate with a blocking tool call                                  | Accepted          | waived                                                      |
| [018](./ADR-018-ork-merges-children.md)            | Ork merges a passing child's branch into its owner's                        | Accepted          | waived                                                      |
| [019](./ADR-019-leaders-resume-on-reentry.md)      | On a loop re-entry, leaders resume and workers start fresh                  | Accepted          | waived                                                      |
| [020](./ADR-020-worktrees-beside-the-clone.md)     | Worktrees beside the clone, with the local layer and committed instructions | Accepted          | waived                                                      |
| [021](./ADR-021-built-in-practices.md)             | Built-in practices: caveman and ponytail, on by default                     | Accepted          | waived                                                      |
| [022](./ADR-022-integration-registry.md)           | Integrations as adapters behind registries                                  | Accepted          | [001](../rfcs/archived/RFC-001-integrations-as-adapters.md) |
| [023](./ADR-023-context-compiler.md)               | How the context compiler hands layers to Claude Code                        | Accepted          | waived                                                      |
| [024](./ADR-024-event-store.md)                    | Runs are recorded in one SQLite store, with a JSONL copy                    | Accepted          | waived                                                      |
| [025](./ADR-025-message-bus.md)                    | Nodes message each other with a notice, then a pull                         | Accepted          | waived                                                      |
| [026](./ADR-026-resume-by-replay.md)               | `ork resume` replays a run's recorded results                               | Accepted          | waived                                                      |
| [027](./ADR-027-advisory-claims.md)                | Claims are advisory, by path, and released when a node ends                 | Accepted          | none                                                        |
| [028](./ADR-028-feedback-capture.md)               | Feedback is captured beside the run's events, grouped by item               | Accepted          | none                                                        |
| [029](./ADR-029-readonly-follows-its-input.md)     | A readonly node with no owner works where its input came from               | Accepted          | waived                                                      |
| [030](./ADR-030-agents-fill-nodes.md)              | Agents are defined once and fill nodes                                      | Accepted          | waived                                                      |
| [031](./ADR-031-ork-is-the-origin.md)              | `.ork/` is the origin; tool folders link to it                              | Accepted          | waived                                                      |
