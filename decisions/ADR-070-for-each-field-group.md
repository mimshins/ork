# ADR-070 — Run a node once per item with a `forEach` field group

- **Status:** Accepted
- **Date:** 2026-11-08
- **Topic:** workflow format, scheduler
- **RFC:** [RFC-013](../rfcs/active/RFC-013-for-each.md) (accepted 2026-11-07;
  moves to `rfcs/archived/` when the Monitor and Builder ship)

## Context

A workflow could not run one step per item of a list without a leader spending
model turns to fan out and gather. Files need a way to say "once per item", and
a workflow file is a public format: a field added to it stays.

## Decision

Option A of the RFC. `forEach` is an optional field group on `claude.worker`,
every `tool.<id>`, `mcp.call` and `workflow.call`:
`{ items | from + maxItems, maxParallel?, onFailure? }`. A declared output may
be `{ list: { … } }`. Items have ids `<node>.<index>` (`build.0`), and the node
finishes once, with a gathered `{ items, results, statuses, count }`.
`schemaVersion` stays 1: every field is optional and additive.

A fanned child of a leader is left out of the `delegate` `child` and
`spawn_worker` `template` enums and runs from its edges only, because a wrong
enum value fails the whole call. Details:
[workflow format](../specs/workflow-format/node-types.md),
[running a node once per item](../specs/scheduler/for-each.md),
[expressions](../specs/expressions.md),
[graph compiler](../specs/graph-compiler.md),
[worktrees](../specs/worktrees.md).

## Options considered

A `control.map` subgraph; mapping over calls only; a pair of control nodes
(fan-out and gather); no change. See the RFC.

## Rationale

A field group reuses each node's own settings, worktree, budget and resume, and
needs no new node type. The other options add a node kind or cover fewer nodes.

## Consequences

Item ids with a `.` reach the store, CLI, worktree names and the UI. Removing or
renaming `forEach` later breaks files. The Monitor and Builder don't draw fanned
nodes yet (recorded in [gaps](../specs/gaps/for-each-limits.md)).
