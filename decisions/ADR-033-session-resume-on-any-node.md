# ADR-033 — Any Claude node can resume its session on re-entry

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** engine / sessions
- **RFC:** waived — part of the project-rules decision; the options are below
- **Amends:** [ADR-019](./ADR-019-leaders-resume-on-reentry.md) (its defaults
  stay)

## Context

ADR-019 resumed leaders and started workers fresh on every re-entry, so a
reviewer stays unbiased. se-backend's process wants the opposite for one role:
one reviewer per task, its session kept across review rounds, so it checks its
own earlier findings instead of starting over.

## Decision

`claude.leader` and `claude.worker` nodes, and agents, take
`session: fresh | resume`. On re-entry (a loop, or another delegation) a node
with `resume` continues its last session with only the new input as its next
message; `fresh` starts a new session with the input in a `## Round n` section.
The default is ADR-019's: `resume` for a leader, `fresh` for a worker. A
`claude.subagent` runs inside its parent's session and ignores it.

## Options considered

- **A workflow-wide switch:** too coarse; one role resumes, the others should
  not.
- **A field on the node and the agent** — chosen: a reviewer agent can carry it.

## Rationale

Whether a role should remember its earlier rounds is the role's choice, not the
node type's. The defaults keep ADR-019's reasoning for the common case.

## Consequences

- A resumed worker's context grows each round, as a leader's does; `maxRounds`
  bounds it.
