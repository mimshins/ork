# Ork

**An orchestration harness for Claude agents that runs on your machine.**

Ork lets you design workflows of agent and tool nodes, save them as plain YAML
next to your code, and run them locally with your own accounts. Think n8n, but
for agents and engineering tasks:

- **Hierarchical.** A leader hands each child only the brief it needs, gets a
  short report back, and has the child's branch merged into its own.
- **Isolated.** Every writing agent works in its own git worktree and branch;
  your checkout is never touched, and Ork never pushes.
- **Context-engineered.** Fresh sessions per task, briefs instead of
  transcripts, cache-friendly prompts, a model and effort per node, budgets, and
  bounded loops.
- **Yours.** Your repository's `CLAUDE.md`, `AGENTS.md` and skills load as they
  do in Claude Code, and Ork never stores a credential.

> **Status: pre-alpha.** The workflow format, `ork run` with delegation and
> worktrees, the context compiler and `ork doctor` work today; live run views,
> the decisions inbox and chat come next, then a web UI. See the
> [roadmap](./docs/interaction-map/roadmap.md).

## Quickstart

You need Node 24.20+, git, and one Claude driver: your own `claude` login, or an
API key, Bedrock or Vertex. `gh` and `aws` are optional, needed only by
workflows that use them. Ork is not on npm yet, so install it
[from source](./docs/getting-started/installation.md#install-from-source-today).

```sh
ork doctor                                   # checks Node, git, your Claude login
ork init                                     # a starter workflow in .ork/workflows/
ork validate                                 # schema, ownership, edges, loops, references
ork run hello --input task="add a README"    # leader, worker, then your approval
ork worktrees                                # the branches it left; `clean` tidies up
```

## Documentation

Everything is in the [documentation center](./docs/README.md):

- **Get started:** [Installation](./docs/getting-started/installation.md)
  (macOS, Linux, Windows via WSL) and the
  [Quickstart](./docs/getting-started/quickstart.md).
- **Guides:** [writing workflows](./docs/guides/writing-workflows.md),
  [running them](./docs/guides/running-workflows.md),
  [leaders and delegation](./docs/guides/leaders-and-delegation.md),
  [skills and context](./docs/guides/skills-and-context.md),
  [worktrees](./docs/guides/worktrees.md),
  [models and budgets](./docs/guides/models-and-budgets.md),
  [accounts and credentials](./docs/guides/accounts.md),
  [troubleshooting](./docs/guides/troubleshooting.md).
- **How it works:** the [design overview](./docs/design.md), the
  [interaction map](./docs/interaction-map/README.md) and the
  [roadmap](./docs/interaction-map/roadmap.md).
- **Reference:** the [specs](./specs/README.md) and the
  [JSON Schema](./packages/schema/workflow.schema.json).
- **Why:** [decisions (ADRs)](./decisions/README.md) and
  [proposals (RFCs)](./rfcs/README.md).
- **Contribute:** [CONTRIBUTING.md](./CONTRIBUTING.md), the
  [Code of Conduct](./CODE_OF_CONDUCT.md), and the
  [runbook](./runbook/development/release.md). Report vulnerabilities as
  [SECURITY.md](./SECURITY.md) describes.

A full example workflow:
[examples/software-factory.ork.yaml](./examples/software-factory.ork.yaml).

## License

[MIT](./LICENSE). Third-party notices:
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
