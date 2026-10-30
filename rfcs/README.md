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

## RFC, ADR, or spec

- An **RFC** weighs viable options before a decision. Durable, numbered.
- An **ADR** records the accepted decision and why, in a self-contained page.
  Every implemented RFC has one; a hard-to-reverse choice without real
  alternatives gets an ADR directly.
- A **spec** in [`specs/`](../specs/README.md) is the contract for what an area
  of Ork does. A **task spec** in `.ai/specs/` (local, gitignored) defines one
  piece of work and is deleted once its outcome lands in a spec, an RFC, or an
  ADR.

The [write-an-rfc](../.ai/skills/write-an-rfc/SKILL.md) skill routes a change
and carries an RFC through this lifecycle.

## Index

| RFC | Title | Status |
| --- | ----- | ------ |
| —   | —     | —      |
