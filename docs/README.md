# Ork documentation

Ork runs workflows of Claude agents and tools on your own machine, with your own
accounts. Start with the getting-started pages, then read the guides as you need
them.

> **Pre-alpha.** Everything in Getting started and Guides works today, unless a
> page marks it as coming later. Live run views, the decisions inbox and chat
> come in milestone M1d; the web UI in M2.

## Getting started

- [Installation](./getting-started/installation.md): what you need, installing
  on macOS, Linux and Windows (WSL), and `ork doctor`.
- [Quickstart](./getting-started/quickstart.md): from `ork init` to a finished
  run in five commands.

## Guides

- [Writing workflows](./guides/writing-workflows.md): inputs, node types, edges,
  conditions, loops and templates.
- [Running workflows](./guides/running-workflows.md): `ork run`, the transcript,
  answering questions and permissions, one node on its own.
- [Leaders and delegation](./guides/leaders-and-delegation.md): owners,
  children, spawned workers, and how their branches are merged.
- [Skills and context](./guides/skills-and-context.md): the layers, your
  project's `CLAUDE.md` and skills, built-in practices, `ork context explain`.
- [Worktrees and isolation](./guides/worktrees.md): where each node works, and
  `ork worktrees`.
- [Models, effort and budgets](./guides/models-and-budgets.md): picking models
  per node, limits, and saving tokens.
- [Feedback from your runs](./guides/feedback.md): what Ork and the agents note
  as runs go, and `ork feedback`.
- [Accounts and credentials](./guides/accounts.md): the two Claude drivers, `gh`
  and `aws`, and what Ork never stores.
- [Troubleshooting](./guides/troubleshooting.md): common messages and what to do
  about them.

## How Ork works

- [Design overview](./design.md): the idea, the milestones, and where each part
  is specified.
- [Interaction map](./interaction-map/README.md): an interactive map of the
  architecture, a run's lifecycle, context and messaging, with what is built on
  every card (`pnpm map` in a clone).
- [Roadmap](./interaction-map/roadmap.md): milestones, what has shipped and what
  is left (the Roadmap page beside the map).

## Reference

- [Specs](../specs/README.md): the contract for each part. Most used:
  - [Workflow file format](../specs/workflow-format.md)
  - [Expressions](../specs/expressions.md) for `when:` and `{{ }}`
  - [CLI](../specs/cli.md)
  - [Context, skills and precedence](../specs/context.md)
- [JSON Schema](../packages/schema/workflow.schema.json) for editor
  autocomplete.
- [Examples](../examples/software-factory.ork.yaml): a full workflow.

## The project

- [Decisions (ADRs)](../decisions/README.md): what was decided, and why.
- [Proposals (RFCs)](../rfcs/README.md): what is being considered.
- [Contributing](../CONTRIBUTING.md), the
  [Code of Conduct](../CODE_OF_CONDUCT.md) and the
  [security policy](../SECURITY.md).
- [Runbook](../runbook/development/release.md): releases and the
  [docs layout](../runbook/development/docs.md), for maintainers.
