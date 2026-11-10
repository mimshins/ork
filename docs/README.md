# Ork documentation

Ork runs workflows of Claude agents and tools on your own machine, with your own
accounts. Start with the getting-started pages, then read the guides as you need
them.

> **Alpha.** Everything in Getting started and Guides works today, unless a page
> marks it as coming later. Coming back after an upgrade? See
> [What's new](./whats-new.md).

## Getting started

Two ways in; both end with a project ready to run workflows.

- **Set it up yourself:** [Installation](./getting-started/installation.md)
  (what you need, macOS, Linux and Windows through WSL, `ork doctor`), then the
  [Quickstart](./getting-started/quickstart.md), from `ork init` to a finished
  run.
- **Have your agent do it:**
  [With your agent](./getting-started/with-your-agent.md): Claude Code, any MCP
  client, or an agent with a shell installs Ork, sets up your project and writes
  a first workflow, asking you before each change.

New to the ideas? [How Ork works](./how-ork-works.md) explains workflows, nodes,
runs and worktrees in plain words.

## Guides

### Running Ork

- [Running workflows](./guides/running-workflows.md): `ork run`, the transcript,
  answering questions, run statuses, picking a run up again.
- [The browser view](./guides/browser-view.md): `ork ui`, its panels and keys,
  and the command that does the same as each action.
- [Worktrees and isolation](./guides/worktrees.md): where each node works, and
  `ork worktrees`.
- [Models, effort and budgets](./guides/models-and-budgets.md): picking models
  per node, limits, and what you spent.
- [The example workflows](./guides/examples.md): what each one does, how to
  download it, and how to run it.
- [Tab completion](./guides/tab-completion.md): commands, flags, run ids and
  node ids completed in zsh, bash and fish.

### Writing workflows

- [Writing workflows](./guides/writing-workflows.md): inputs, node types, edges,
  conditions, loops and templates.
- [Agents](./guides/agents.md): define who does the work once, give it to any
  node, and use your project's own agents.
- [Leaders and delegation](./guides/leaders-and-delegation.md): owners,
  children, spawned workers, and how their branches are merged.
- [Skills and context](./guides/skills-and-context.md): the layers, your
  project's `CLAUDE.md` and skills, built-in practices, `ork context explain`.
- [Scripts in a workflow](./guides/scripts.md): JSON results, `env:`, and what a
  program knows about its run.
- [Watching a source](./guides/watching.md): wait on CI or a review inside a
  run, or start a run when something happens, with no model turn until it does.

### Your projects

- [Projects](./guides/projects.md): Ork's files in your repository (`ork init`)
  or beside it (`ork register`); moving in later, and a first workflow drafted
  from your agents (`ork migrate`).
- [Project rules](./guides/project-rules.md): `.ork/project.yaml`: never commit,
  merge or not, your own branch names, permissions and defaults for every
  workflow.
- [Working across projects](./guides/working-across-projects.md): run workflows
  in several repositories, and let their sessions message each other.

### With Claude Code

- [Ork from Claude Code](./guides/claude-code.md): Ork's plugin, so Claude Code
  writes workflows Ork accepts, reads your runs, and starts them when you say.

### Help

- [Feedback from your runs](./guides/feedback.md): what Ork and the agents note
  as runs go, and `ork feedback`.
- [Drivers](./guides/drivers.md): the agent tools Ork can run, what each does
  and refuses, and why permissions are denied unless allowed.
- [Accounts and credentials](./guides/accounts.md): each driver's login, `gh`
  and `aws`, and what Ork never stores.
- [Where Ork keeps things](./guides/where-ork-keeps-things.md): what's on your
  machine, what leaves it, and removing Ork.
- [Troubleshooting](./guides/troubleshooting.md): common messages and what to do
  about them.
- [What's new](./whats-new.md): each release in a few lines, and how to upgrade.

## Reference

The exact rules, for when a guide isn't enough.

- [Specs](../specs/README.md): the contract for each part. Most used:
  - [Workflow file format](../specs/workflow-format.md)
  - [Expressions](../specs/expressions.md) for `when:` and `{{ }}`
  - [CLI](../specs/cli.md)
  - [Context, skills and precedence](../specs/context.md)
- [JSON Schema](../packages/schema/workflow.schema.json) for editor
  autocomplete.
- [The example workflows](./guides/examples.md): full workflows to read.

## The project

For contributors:

- [Design overview](../specs/design.md): the idea, the milestones, and where
  each part is specified.
- [Interaction map](./interaction-map/README.md): an interactive map of the
  architecture, a run's lifecycle, node roles, context, messaging and the
  feedback loop, with what is built on every card (`pnpm map` in a clone).
- [Roadmap](./interaction-map/roadmap.md): milestones, what has shipped and what
  is left (the Roadmap page beside the map).
- [Decisions (ADRs)](../decisions/README.md): what was decided, and why.
- [Proposals (RFCs)](../rfcs/README.md): what is being considered.
- [Onboarding](../ONBOARDING.md): an ordered way to read the project and its
  code.
- [Contributing](../CONTRIBUTING.md), the
  [Code of Conduct](../CODE_OF_CONDUCT.md) and the
  [security policy](../SECURITY.md).
- [Runbook](../runbook/development/release.md): releases and the
  [docs layout](../runbook/development/docs.md), for maintainers.
