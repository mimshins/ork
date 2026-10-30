# Ork

**An orchestration harness for Claude agents that runs on your machine.**

Ork lets you design workflows of agent and tool nodes, then run them locally
from a CLI (`ork`) or a localhost web UI (`ork ui`). Think n8n, but for agents
and engineering tasks:

- **Hierarchical.** Every node can own descendants. An owner gives its children
  only the context they need, receives short reports back, merges their work,
  and handles their escalations.
- **Serializable.** A workflow is a plain YAML file (plus an optional layout
  file for the canvas), so you can review it, share it, and version it with git.
- **Context-engineered.** Fresh sessions per task, briefs instead of
  transcripts, cache-friendly prompts, per-node models and budgets, bounded
  loops.
- **Human in the loop.** Agents ask questions with clear options and a
  recommended answer; every pending question across the run lands in one
  decisions inbox. You can chat with any node, and every event is logged.
- **Works with your repo.** Your project's `CLAUDE.md`, `AGENTS.md`, and skills
  are layered under the workflow's own skills with a defined precedence.

> **Status: pre-alpha.** The workflow format, the graph compiler, both Claude
> drivers, `ork init` / `ork validate` / `ork doctor`, and running a single node
> (`ork run --node`) work today; the scheduler for whole workflows and the UI
> are being built. See [docs/design.md](./docs/design.md), and the
> [interaction map](./docs/interaction-map/README.md) (`pnpm map`) for how the
> pieces fit together and what is built so far.

```sh
npm install --global @krapht/ork   # from a clone: pnpm ork <command>
ork doctor        # node, git, and your own claude / gh / aws logins
ork init          # scaffold .ork/ with a starter workflow
ork validate      # schema, ownership tree, edges, loops, references
ork run hello --node lead --input task="add a README" --in-place
```

## A workflow

```yaml
schemaVersion: 1
name: review-loop
inputs:
  feature:
    type: string
    required: true
nodes:
  builder:
    type: claude.leader
    prompt: "Implement: {{inputs.feature}}"
    model: opus
  security:
    type: claude.worker
    parent: builder
    isolation: readonly
  code:
    type: claude.worker
    parent: builder
    isolation: readonly
  reviews:
    type: control.join
  human:
    type: human.gate
    question: Merge the builder's branch?
    options: [merge, reject]
    recommended: reject
edges:
  - builder -> security, code
  - security, code -> reviews
  - from: reviews
    to: builder
    when: any(statuses, 'changes_requested')
    maxRounds: 2
  - from: reviews
    to: human
    when: all(statuses, 'pass')
```

The full example is in
[examples/software-factory.ork.yaml](./examples/software-factory.ork.yaml).
Editors that support `yaml-language-server` get autocomplete from the published
[JSON Schema](./packages/schema/workflow.schema.json).

## Your accounts, your machine

Ork is free and local. It never stores, proxies, or asks for credentials: each
integration uses the tool you already have and its own login.

| Integration | How Ork reaches it                                                                      |
| ----------- | --------------------------------------------------------------------------------------- |
| Claude      | `ANTHROPIC_API_KEY` (or Bedrock/Vertex) with the Agent SDK driver, or your `claude` CLI |
| GitHub      | your `gh` CLI (`gh auth login`)                                                         |
| AWS         | your `aws` CLI (`aws sso login` or a profile)                                           |

A note on the `claude` CLI driver: Anthropic's terms do not allow third-party
products to offer claude.ai login or to route requests through Free, Pro, or Max
plan credentials on a user's behalf. The Agent SDK driver with an API key (or a
cloud provider) is the clearly supported path; check Anthropic's current terms
before using the CLI driver with a subscription login.

## Development

Requires Node 24.20+ and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
pnpm check        # format check, lint, typecheck, tests
pnpm ork --help   # run the CLI from source
```

See [AGENTS.md](./AGENTS.md) for conventions. The contracts are the
[specs](./specs/README.md); decisions and their reasons are the
[ADRs](./decisions/README.md).

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md). Report vulnerabilities privately, as
described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
