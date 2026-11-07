# ADR-052 — Conditions chosen from what a node declares it can say

- **Status:** Accepted
- **Date:** 2026-11-04
- **Topic:** workflow format / UI / run semantics
- **RFC:**
  [RFC-010](../rfcs/archived/RFC-010-conditions-from-declared-outputs.md)

## Context

A `when:` was free text in the builder, so a value could be mistyped, and a
condition that never matches ends a run quietly. The maintainer's rule is to
prevent a mistake where possible and detect only what's left. A list of choices
needs a declared shape, and tools and MCP calls had none.

## Decision

**Every node has one list of what it can say** (`nodeSays`,
[says.ts](../packages/core/src/graph/says.ts)): a Claude node's closed `status`
and its schema fields, a gate's options, a call's status, a join's statuses.

**Tools and MCP calls can declare their output,** in the shape Claude nodes
already use, one level deep:
`output: { format: json, schema: { state: [OPEN, CLOSED] } }`. It stays
optional. Reading an undeclared `json.<field>` warns (`ref.undeclared`).

**A run holds a node to what it declared.** A missing field, the wrong type or a
value outside the list fails the node, and the reason names all three. This is
one check for tool JSON, MCP results and Claude schema fields
([declared.ts](../packages/core/src/run/declared.ts)). A Claude field written as
raw JSON Schema stays the driver's to enforce.

**An edge can read `ok`, how its source ended.** Such a failure leaves no field
to test: a tool that failed this way exited 0, and an MCP call has no exit code.
`notify:` rules could already read `ok`, but an edge couldn't, so `!ok` read as
true every time. A field the node itself reports under that name still wins, so
no workflow changes meaning.

**The builder picks conditions from that list:** when to follow the edge, then a
field, a test and a value. It writes the same `when:` a person would, so the
format doesn't change. A `when:` the rows can't show stays as written, marked
"Written by hand", and is never rewritten to fit, including a value off the
list, so a typo stays visible.

**New edges start valid.** Closing a loop writes a condition and rounds at once,
a gate's edge takes its next unhandled answer, a way out of a loop starts as
what the loop isn't, and a router's edge starts with a test or a fallback.

**Lists stay in step with what reads them.** Renaming a value follows into the
conditions that read it, through routers and splits, and into a gate's
`recommended` and `default`. Removing a value something reads is refused, naming
the edge.

## Options considered

From RFC-010, in full there: only detecting (the typo still gets made);
suggestions on a text box (they can be ignored); choices with no format change
(tools stay free text, though deterministic workflows branch on them); a
structured `when:` in the file (two spellings, and a typo in a value still
passes a schema); requiring a shape on all JSON output (breaks nodes that only
pass JSON to a template).

## Rationale

On the CLI driver, a session told to report a value outside its schema was
rejected by `StructuredOutput` twice, and ended with no report, which Ork
already fails. So checking Claude fields can't fail a session that works today
there. The SDK driver wasn't measured, as it needs an API key.

A real run found what the tests didn't: `!ok` on an edge was always true,
because edges didn't have `ok`. That's why it's part of this decision.

## Consequences

- The format gains `output.schema` on tools, MCP calls and steps.
- Some edits now refuse, where they used to leave a condition that never
  matches.
- The checks in [RFC-009](../rfcs/archived/RFC-009-walking-a-workflow.md) become
  the fallback for hand-written files, and read this list.
- Limits: [L112 to L115](../specs/ui/builder-limits.md) (L115 since merged into
  [C5](../specs/runtime.md#limits)).
