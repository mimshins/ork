# Specs

A spec is the contract for what Ork does: current behavior where it is built,
and the agreed behavior where it is specified. Code, tests and specs agree; a
change to behavior updates its spec in the same pull request.

- An **RFC** ([rfcs/](../rfcs/README.md)) proposes a change with real
  alternatives, before it is decided.
- An **ADR** ([decisions/](../decisions/README.md)) records an accepted decision
  and why.
- A **task spec** (`.ai/specs/`, local and gitignored, from
  [the template](../.ai/templates/spec.md)) plans one piece of work and is
  thrown away once its outcome lands here or in an ADR.

Long specs follow the hub and chunk layout
([runbook/development/docs.md](../runbook/development/docs.md)).

## Index

| Spec                                            | Status    | Milestone |
| ----------------------------------------------- | --------- | --------- |
| [Core concepts](./concepts.md)                  | Specified | M1        |
| [Architecture](./architecture.md)               | Partial   | M1, M2    |
| [Workflow file format](./workflow-format.md)    | Built     | M1a       |
| [Expressions](./expressions.md)                 | Built     | M1a       |
| [Graph compiler](./graph-compiler.md)           | Built     | M1a       |
| [Runtime: the Claude drivers](./runtime.md)     | Built     | M1b       |
| [Context, skills and precedence](./context.md)  | Specified | M1c       |
| [Messaging, decisions and logs](./messaging.md) | Partial   | M1d       |
| [Feedback and self-improvement](./feedback.md)  | Specified | M1d, M2   |
| [The ork CLI](./cli.md)                         | Partial   | M1        |
| [The UI](./ui.md)                               | Planned   | M2        |

**Status:** _Built_ means on `main` with tests; _Partial_ means some of it is
built and the spec says which; _Specified_ means agreed, not built; _Planned_
means designed for a later milestone.
