# ADR-028 — Feedback is captured beside the run's events, grouped by item

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** feedback / capture
- **RFC:** none — capture was decided in [ADR-013](./ADR-013-feedback-loop.md)
  and specified in [specs/feedback.md](../specs/feedback.md); this records where
  it lives and the choices the spec left open

## Context

ADR-013 settled the feedback loop: system signals, agent reports and human
notes, recorded locally, grouped by fingerprint, triaged and published later.
Building capture (M1d) left open where signals are derived, which record carries
a status, and how an agent's report gets its target.

## Decision

1. **Signals are derived where events are recorded.** The CLI passes every event
   of a run, the decision queue's included, through one observer
   ([signals.ts](../packages/core/src/feedback/signals.ts)) before the recorder.
   It returns the event, then any `feedback.recorded` event it signals, so a
   signal sits right after its cause in the run's stream. The scheduler never
   sees decisions, so it could not derive them itself.
2. **Six signals:** a loop out of rounds, a budget that ran out, a tool the user
   denied, an Ork tool that failed, a gate that timed out, and an answer other
   than the recommended one. Each has a code in its fingerprint.
3. **The same observer fills in origins** (workflow, its hash, node type, model,
   driver, Ork version) and drops a run's duplicates, for agent reports too.
4. **Agents report through a port** each session gets
   ([agent.ts](../packages/core/src/feedback/agent.ts)): masked, capped at 3 per
   session, a run's duplicates answered as recorded. A report without a target
   takes its kind's: `bug` is about Ork, `context-gap` and `skill` the project,
   the rest the workflow.
5. **The store writes records and items:** each `feedback.recorded` event is
   also a row in `feedback`, and its fingerprint a row in `feedback_items`,
   which holds the status. Status is per item, because triage and dismissal act
   on items; a dismissed item stays dismissed when it recurs.

## Options considered

- **Signals in the scheduler:** sees run events but not the decision queue's, so
  it would miss permission denials and overridden recommendations. Rejected.
- **A status on every record:** dismissing an item would update each record, and
  a new record of a dismissed item would come back as `new`. Rejected.
- **Target only from the agent:** agents leave it out or guess; the kind is a
  better default, and the agent can still say.

## Consequences

- Runs started any way (`ork run`, `--node`, `ork resume`) record feedback the
  same way.
- `ork feedback list | show | dismiss` read the store; triage, apply, lessons
  and publishing (M2) work on the same items.
- A resumed run may record a signal its first part already recorded; both count
  toward the same item.
