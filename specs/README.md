# Specs

A spec is the contract for what Ork does: current behavior where it is built,
and the agreed behavior where it is specified. Code, tests and specs agree; a
change to behavior updates its spec in the same pull request.

- An **RFC** ([rfcs/](../rfcs/README.md)) proposes a change with real
  alternatives, before it is decided.
- An **ADR** ([decisions/](../decisions/README.md)) records an accepted decision
  and why.
- A **plan** (`.ai/plans/`, local and gitignored, from
  [the template](../.ai/templates/plan.md)) sets out one piece of work and is
  thrown away once its outcome lands here or in an ADR.

Long specs follow the hub and chunk layout
([runbook/development/docs.md](../runbook/development/docs.md)).

Start with the [design overview](./design.md): the idea, the milestones, and
where each part is specified.

## Index

| Spec                                                      | Status    | Milestone |
| --------------------------------------------------------- | --------- | --------- |
| [Core concepts](./concepts.md)                            | Specified | M1        |
| [Architecture](./architecture.md)                         | Built     | M1, M2    |
| [Workflow file format](./workflow-format.md)              | Built     | M1a       |
| [Expressions](./expressions.md)                           | Built     | M1a       |
| [Graph compiler](./graph-compiler.md)                     | Built     | M1a       |
| [Runtime: the agent drivers](./runtime.md)                | Built     | M1b       |
| [Scheduler: running a workflow](./scheduler.md)           | Built     | M1c       |
| [Worktrees: where nodes work](./worktrees.md)             | Built     | M1c       |
| [Project rules](./project-rules.md)                       | Built     | M1e       |
| [Check once: skip a passed check](./check-once.md)        | Built     | M2        |
| [The machine: slots, priority, CPU](./machine.md)         | Built     | M2        |
| [Projects: in-repo or attached](./projects.md)            | Built     | M1e       |
| [Integration: locks, conflicts, issues](./integration.md) | Built     | M2        |
| [Context, skills and precedence](./context.md)            | Built     | M1c       |
| [Messaging, decisions and logs](./messaging.md)           | Built     | M1d       |
| [Pause, continue and stop](./run-control.md)              | Built     | M2        |
| [Event store: what a run keeps](./event-store.md)         | Built     | M1d       |
| [Usage: what runs spent over time](./usage.md)            | Built     | M2        |
| [Feedback and self-improvement](./feedback.md)            | Built     | M1d, M2   |
| [The ork CLI](./cli.md)                                   | Built     | M1        |
| [The local server](./server.md)                           | Built     | M2        |
| [Ork for Claude Code](./claude-code.md)                   | Built     | M2        |
| [The UI](./ui.md)                                         | Built     | M2        |
| [Known gaps and limits](./gaps.md)                        | Open      | All       |

**Status:** _Built_ means on `main` with tests; _Partial_ means some of it is
built and the spec says which; _Specified_ means agreed, not built; _Planned_
means designed for a later milestone; _Open_ means entries wait for a decision.
