# ADR-075 — A `session.waiting` event for a wait before a tool starts

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** runtime
- **RFC:** [RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md), decided by
  the maintainer while the Command Code lease was built

## Context

Command Code keeps its MCP entry per folder, so a second session in the same
checkout waits for the first. The wait happens before the tool starts, so no
existing `RuntimeEvent` fits, and reusing the node's pause events (`node.held`,
`node.released`) would mix two meanings.

## Decision

Add a `RuntimeEvent` `{ type: "session.waiting"; reason }` to the runtime port
([types.ts](../packages/core/src/runtime/types.ts)). The session runner emits it
while an MCP wiring waits. Logs and the UI show it as one line. Replay ignores
it and nothing is derived from it, so stored runs stay resumable.

## Consequences

- The event is stored with the run, so removing it later means old runs keep a
  type the reader must still accept. That is why it is recorded here.
- Any driver whose wiring can wait uses it; no other port change.
