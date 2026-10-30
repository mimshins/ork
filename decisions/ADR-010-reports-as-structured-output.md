# ADR-010 — Node reports as structured output

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** runtime
- **RFC:** waived — decided while building the runtime on 2026-10-30

## Context

A Claude node ends by handing its owner a report: a status (`pass`,
`changes_requested`, `fail`, `done`), a short summary, artifact paths, a branch,
and any fields its `output.schema` asks for (for example `verdict`). The first
design had the agent call a `report` MCP tool. While building the drivers it
turned out both the Agent SDK (`outputFormat: { type: "json_schema" }`) and the
CLI (`--json-schema`) support validated structured output for the session's
final result.

## Decision

The report is the session's **structured output**:

- Ork builds a JSON Schema per node from the standard report fields and the
  node's `output.schema` (a list becomes an enum, a primitive name a type, an
  object is taken as JSON Schema)
  ([report.ts](../packages/core/src/runtime/report.ts));
- both drivers pass it to Claude Code, which makes the final answer conform;
- the driver reads `structured_output` from the result and validates it again
  into a `NodeReport`; a session that ends without a valid report has
  `report: null`.

## Options considered

- **A `report` MCP tool.** The agent might never call it, call it twice, or call
  it before it is done; Ork would have to enforce all of that itself.
- **Parse the final text.** Fragile.
- **Structured output** — chosen.

## Rationale

Claude Code enforces the schema and retries when the answer does not match, so
the report is always the session's last word and always well-formed, without a
tool call per node and without prompt text explaining a protocol.

## Consequences

- `report` is not in Ork's tool list; [specs/runtime.md](../specs/runtime.md)
  and [specs/messaging.md](../specs/messaging.md) describe the report as
  structured output.
- `when:` conditions and templates read the same fields the schema defines.
- A driver without structured output could not run Claude nodes; both current
  drivers have it.
