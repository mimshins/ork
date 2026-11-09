# ADR-073 — Keep a report's list fields across rounds with `output.gather`

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** workflow format, scheduler
- **RFC:** waived — the maintainer decided this directly in a design review

## Context

A node that runs again in a loop reports anew, and its new report replaced the
last one. In build run `c1a569ed`, the leader reported 19 decisions in round 1,
then only each fix round's new ones (3, 0, 0). The `ratify` gate reads
`{{nodes.build.output.decisions}}`, so it showed an empty list, although every
node's decisions were in the run's record. None was hard to reverse that time,
but the gate exists to catch the ones that are.

## Decision

A Claude node's `output` takes `gather`: the names of `output.schema` fields,
declared as lists, kept across the node's rounds. After each round, each such
field holds the earlier rounds' entries followed by this round's, leaving out an
entry exactly equal to one already there. Every other field holds the latest
round, as before. The engine does the joining
([gather.ts](../packages/core/src/run/gather.ts)), so it doesn't rely on a model
repeating what it said. Joining is idempotent, so a resumed run, which hands
back recorded results already joined, gives the same lists; a delegated child
that hasn't run since the resume starts from its last recorded report. A spawned
instance gathers only its own run, since a leader's next round reuses its id.
`ork validate` refuses a field that isn't declared or isn't a list
(`{ type: array }`, or `{ list: { … } }` as RFC-013 reads it), and `gather` on a
node with `forEach`. Details:
[node types](../specs/workflow-format/node-types.md),
[scheduler](../specs/scheduler.md#activations).

## Options considered

- **Prompt the leader to repeat every earlier decision.** Ships without a
  release, but a model forgets; it already didn't follow the instruction to
  gather the plan's Decided section.
- **A flag inside the field's schema.** Reads close to the field, but a Claude
  node's `output.schema` is free-form, so validate could check it less well.
- **A read-side path such as `nodes.build.rounds.decisions`.** Changes no node,
  but every reader has to remember to use it.

## Consequences

- `output.gather` is a new optional field: files without it run as before, and
  `schemaVersion` stays 1.
- Exact repeats are dropped, so an entry a later round reports again, word for
  word, is listed once; one reworded is listed twice.
- This repository's `build` leader gathers `decisions`.
