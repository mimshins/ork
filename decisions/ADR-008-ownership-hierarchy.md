# ADR-008 — Ownership hierarchy rules

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** workflow format / engine
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Ork is hierarchical: a node can own descendants, give them only the context they
need, receive their reports, and handle their escalations. A workflow also has
n8n-style flow edges. The two had to fit together without ambiguity about when a
node runs and who it answers to.

## Decision

1. **Ownership is a tree** declared by `parent` on each node, separate from flow
   edges ([tree.ts](../packages/core/src/graph/tree.ts)).
2. **Leaders own.** Only a `claude.leader` owns non-sub-agent nodes. A
   `claude.subagent` is owned by a `claude.leader` or `claude.worker` and runs
   inside that node's Claude Code session; it takes no flow edges. Tool,
   control, and gate nodes own nothing. The tree has no cycles.
3. **When a node runs.** Entry nodes have no incoming edge and no owner. An
   owned node with no incoming edge runs only when its owner delegates to it. An
   owned node with incoming edges also runs when they fire.
4. **What ownership gives.** The owner compiles the child's context packet,
   receives its report, merges its worktree, and handles its escalations; parent
   and child may always message each other, while siblings need a declared
   `messages` channel.

Details: [specs/concepts.md](../specs/concepts.md),
[specs/graph-compiler.md](../specs/graph-compiler.md).

## Options considered

- **Flow edges only**, with hierarchy implied by the graph. Loses the owner's
  responsibilities (context, merge, escalation) and dynamic delegation.
- **Hierarchy only**, every run driven by leaders. Loses the explicit,
  reviewable pipeline of a static workflow.
- **Both, with these rules** — chosen.

## Rationale

Static edges make the common pipeline visible; ownership gives each subtree one
responsible node and lets a leader delegate dynamically. Restricting ownership
to leaders keeps the question "who handles this escalation" with one answer.

## Consequences

- The compiler rejects owners of the wrong kind, unknown parents, ownership
  cycles, and edges to sub-agents.
- Dynamically spawned workers (`spawn_worker`) are owned by the spawning leader,
  under its `maxWorkers` cap.
