# RFCs (proposals)

RFCs are numbered design documents for architectural, structural, or
cross-cutting changes with real alternatives. They capture the problem, the
options, the trade-offs, and the decision, so future readers understand **why**
the design looks the way it does. They are project knowledge and stand on their
own without any AI tooling.

## Lifecycle

Tracked in the **Status** field and by directory:

| Status        | Directory   | Meaning                                           |
| ------------- | ----------- | ------------------------------------------------- |
| `Draft`       | `active/`   | Being written; not yet reviewed.                  |
| `Proposed`    | `active/`   | Ready for review and decision.                    |
| `Accepted`    | `active/`   | The decision is agreed; implementation may begin. |
| `Implemented` | `archived/` | Shipped; the decision is recorded as an ADR.      |
| `Rejected`    | `archived/` | Not adopted; kept so the "why not" is not lost.   |
| `Superseded`  | `archived/` | Replaced by a newer RFC or ADR; kept for history. |

An RFC that is not `Accepted` never overrides [`specs/`](../specs/README.md) or
an accepted ADR.

## Conventions

- **Location:** `rfcs/active/` and `rfcs/archived/`.
- **Naming:** `RFC-NNN-<kebab-case-title>.md`; the next free number, never
  reused. Start from [`.ai/templates/rfc.md`](../.ai/templates/rfc.md).
- **Sections:** metadata (Status, Date, Supersedes, Superseded by), Context,
  Options (each with pros and cons), Decision, Consequences.
- **Self-contained:** understandable on its own; link out for context only.
- **One decision per RFC:** split independent decisions into separate RFCs.
- **Atomic:** a long RFC gets a `## Contents` list, never a chunk folder.

## When it ships

1. Fold the current behavior into the affected [specs](../specs/README.md).
2. Record the decision as an ADR in [`decisions/`](../decisions/README.md) and
   link the two both ways.
3. Set the RFC's status to `Implemented` and move it to `archived/`; update both
   indexes.

## Which document

Each answers a different question and lasts a different time.

| Document                                   | The question it answers                 | Lifetime                       |
| ------------------------------------------ | --------------------------------------- | ------------------------------ |
| Brief                                      | What do we want, and why?               | Until it is built              |
| **RFC**                                    | Which approach, and why not the others? | Permanent, archived            |
| [**ADR**](../decisions/README.md)          | What did we decide?                     | Permanent                      |
| [**Spec**](../specs/README.md)             | What does Ork do?                       | Living, always current         |
| **Plan** (`.ai/plans/`, local, gitignored) | How does this one change get built?     | Deleted once its outcome lands |

Every implemented RFC has an ADR; a hard-to-reverse choice without real
alternatives gets an ADR directly.

The [write-an-rfc](../.ai/skills/write-an-rfc/SKILL.md) skill routes a change
and carries an RFC through this lifecycle. `ork run rfc` drafts one with you and
`pnpm rfc:close RFC-NNN` does the move, the index and the links when it ships.

## Index

| RFC                                                            | Title                                                              | Status      |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | ----------- |
| [001](./archived/RFC-001-integrations-as-adapters.md)          | Integrations as adapters behind a registry                         | Implemented |
| [002](./archived/RFC-002-standalone-binaries-and-installer.md) | Standalone binaries and a one-line installer                       | Rejected    |
| [003](./archived/RFC-003-relay-between-runs.md)                | A relay between runs                                               | Implemented |
| [004](./archived/RFC-004-workflows-calling-workflows.md)       | Workflows that call workflows                                      | Implemented |
| [005](./archived/RFC-005-scripts-and-rules-on-the-bus.md)      | Scripts and rules on the message bus                               | Implemented |
| [006](./archived/RFC-006-steps-around-a-session.md)            | Deterministic steps around a session, MCP calls and inline scripts | Implemented |
| [007](./archived/RFC-007-limits-across-runs.md)                | Limits across runs                                                 | Implemented |
| [008](./archived/RFC-008-workflow-builder.md)                  | A workflow builder that keeps the YAML                             | Implemented |
| [009](./archived/RFC-009-walking-a-workflow.md)                | Walking every way through a workflow before it runs                | Implemented |
| [010](./archived/RFC-010-conditions-from-declared-outputs.md)  | Conditions chosen from what a node declares it can say             | Implemented |
| [011](./archived/RFC-011-watching-a-source.md)                 | Watching a source, and acting on what it says                      | Implemented |
| [012](./archived/RFC-012-teaching-claude-code-ork.md)          | Teaching Claude Code Ork's standards: an MCP server and skills     | Implemented |
| [013](./archived/RFC-013-for-each.md)                          | Running a node once per item of a list                             | Implemented |
| [014](./active/RFC-014-cli-drivers-only.md)                    | CLI drivers only: claude, OpenCode and Command Code                | Accepted    |
| [015](./active/RFC-015-format-for-several-drivers.md)          | A workflow format for several drivers                              | Proposed    |
