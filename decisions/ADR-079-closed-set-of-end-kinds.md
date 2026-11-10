# ADR-079 — Every node ends as one kind of a closed set

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** runtime port, scheduler, feedback, user interface
- **RFC:** waived — the maintainer decided this directly, choosing between the
  alternatives below on 2026-11-10 (plan "Normalized outcomes")

## Context

The gate runs showed one cause in three shapes: Claude Code's `error_max_turns`,
Command Code's exit 8, and OpenCode's "no valid report" at its step cap (L239).
A provider's raw JSON reached the run summary (L240's prefill error), and a
model's bad report was filed as "Ork's report tool returned an error", an Ork
bug that was the agent's. Each driver and node type said its own words, so a
user could not tell what to do, or who should.

## Decision

Every way a node can end, on every driver and node type, is one kind of a closed
set in core (`EndKind`, `END_KINDS`:
[ends.ts](../packages/core/src/runtime/ends.ts)). Each kind has a label, Ork's
own message with the node's numbers, who acts (the agent, the workflow, the
account, the provider, the user or Ork), whether it may pass (transient),
whether it stops the run, a hint, and a section of
[why a node stopped](../docs/guides/why-a-node-stopped.md). A test fails when a
kind lacks its registry entry or its section.

- **Adapters map what only they can see** (exit codes, subtypes, OpenCode's step
  cap); **one shared classifier** reads provider errors by their type, then
  their status, then their words
  ([provider-errors.ts](../packages/runtime/src/provider-errors.ts)). A decoder
  never leaves `end` unset; `unknown` files an Ork bug with the detail.
- **The end travels** on `SessionOutcome`, `NodeResult` and `node.finished`
  (`end: { kind, message, detail? }`). A run stored before ends is read through
  a legacy mapping from its `error` text, never rewritten.
- **The raw text is kept**, scrubbed with the feedback redactor and capped at 4
  KiB, as the detail, shown only on request (`--verbose`, `ork logs --node`, the
  browser view's Details). The message never quotes a provider.
- **Feedback files by actor**: Ork's bugs, the workflow's, the agent's context
  gaps; an account's, provider's or user's end is a setup hint, not feedback. A
  report the `report` tool refuses is the agent's.
- **`invalid_node`** was added to the plan's first set, for a node that could
  not start (a bad setting, an MCP server it names, a `forEach` list or a
  `watch` condition), since none of the others was true.
- **The server resolves the registry** into an `EndView` (label, actor, hint,
  guide anchor) on the run tree's `end` and on the streamed `node.finished`
  ([end-view.ts](../packages/server/src/end-view.ts)); the browser view imports
  only the server's client entry, never core, so the words exist once.
- **No automatic retry.** Transient kinds are classified and explained, set
  `NodeResult.transient`, and say that `ork resume` retries (L246).

## Options considered

- **One central classifier over the raw text only.** It would need every
  driver's exit codes and subtypes, and would guess what an adapter knows.
- **Each adapter classifying everything.** The provider rules would exist three
  times over, and drift.
- **Retry transient kinds automatically.** Deferred: it needs a policy (tries,
  waits) the plan did not settle.

## Consequences

- A new way to end is a new kind: its registry entry, its guide section, and the
  adapter or node that sets it, in one change. The set is hard to shrink: stored
  events, the server's API and the UI carry the kind's name.
- Run-level statuses (`failed`, `budget_exhausted`, `quota_exhausted`) are
  unchanged; their reasons use the kinds' messages.
- What is left simpler is L241 and L243 to L248 in the
  [register](../specs/gaps/end-kinds-limits.md); L239 is closed.
- `SessionOutcome.subtype` stays one release for stored events, and is no longer
  read for decisions, except by two readers (L243).
