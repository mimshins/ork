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

| ADR                                                | Title                                                             | Status   | RFC    |
| -------------------------------------------------- | ----------------------------------------------------------------- | -------- | ------ |
| [001](./ADR-001-spec-driven-development.md)        | Spec-driven development and the knowledge layout                  | Accepted | waived |
| [002](./ADR-002-typescript-from-source.md)         | A TypeScript monorepo run from source, with supply-chain policies | Accepted | waived |
| [003](./ADR-003-oxlint-oxfmt-and-boundaries.md)    | oxlint and oxfmt, with package boundaries enforced by lint        | Accepted | waived |
| [004](./ADR-004-no-credentials.md)                 | Ork never handles credentials                                     | Accepted | waived |
| [005](./ADR-005-one-runtime-port-two-drivers.md)   | One runtime port, two Claude drivers                              | Accepted | waived |
| [006](./ADR-006-workflow-file-format.md)           | The workflow file format                                          | Accepted | waived |
| [007](./ADR-007-safe-expression-language.md)       | A safe expression language for conditions and templates           | Accepted | waived |
| [008](./ADR-008-ownership-hierarchy.md)            | Ownership hierarchy rules                                         | Accepted | waived |
| [009](./ADR-009-worktree-per-writing-node.md)      | A git worktree per writing node                                   | Accepted | waived |
| [010](./ADR-010-reports-as-structured-output.md)   | Node reports as structured output                                 | Accepted | waived |
| [011](./ADR-011-in-house-mcp-server.md)            | A minimal in-house MCP server for the CLI driver                  | Accepted | waived |
| [012](./ADR-012-no-ai-attribution.md)              | No AI or agent attribution                                        | Accepted | waived |
| [013](./ADR-013-feedback-loop.md)                  | The feedback loop                                                 | Accepted | waived |
| [014](./ADR-014-interaction-map.md)                | The interaction map as the onboarding and audit view              | Accepted | waived |
| [015](./ADR-015-changesets-and-one-bundled-cli.md) | Releases with changesets and one bundled CLI                      | Accepted | waived |
