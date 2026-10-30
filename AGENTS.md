# AGENTS.md

Ork is a local, open-source orchestration harness for Claude agents: a workflow
of hierarchical agent and tool nodes, designed in a CLI or a localhost UI,
serialized to git-friendly YAML, and run on the user's own machine with the
user's own accounts. See [README.md](./README.md) and the design in
[docs/design.md](./docs/design.md).

**This repository is public.** Everything committed here, including issues and
pull requests, is world-readable. Never commit credentials, tokens, or personal
data.

## Layout

| Package                   | Role                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| `packages/schema`         | Workflow file format: Zod model, JSON Schema, canonical YAML          |
| `packages/core`           | Graph compiler, scheduler, context compiler, message bus, event store |
| `packages/runtime-claude` | `ClaudeRuntime` drivers: Agent SDK and headless `claude` CLI          |
| `packages/nodes`          | Built-in node types                                                   |
| `packages/server`         | Local HTTP + SSE API (milestone 2)                                    |
| `packages/cli`            | The `ork` command                                                     |

Dependency direction (enforced by `oxlint.config.ts`):
`schema <- core <- runtime-claude, nodes <- server <- cli`. Import other
packages through their public entry point (`@ork/<name>`), never by relative
path.

## Commands

- `pnpm check` runs format check, lint, typecheck, and tests; it must pass
  before a push (the `pre-push` hook runs it).
- `pnpm format` fixes formatting (oxfmt); `pnpm lint:fix` fixes lint (oxlint).
- `pnpm ork <args>` runs the CLI from source.
- `pnpm --dir packages/schema gen:json-schema` regenerates
  `workflow.schema.json` after a schema change (a test fails when it is stale).

## Interaction map

[docs/interaction-map/](./docs/interaction-map/README.md) is an interactive map
of how Ork works (architecture, run lifecycle, context and skills, messaging and
decisions), with an honest status on every card. `pnpm map` serves it on
`http://localhost:8791`; `pnpm map:check` (part of `pnpm check`) validates its
data, doc links and statuses. When a change builds, moves or reshapes something
the map shows, update the map in the same change, or run the `/resync-map` skill
([sync.md](./docs/interaction-map/sync.md)).

## Conventions

- Node 24 runs the TypeScript sources directly (type stripping): only erasable
  syntax (no enums, no parameter properties, no namespaces), and relative
  imports carry the `.ts` extension.
- Arrow-function expressions, `type` aliases (not `interface`), inline type
  imports, no non-null assertions, no `any`.
- Zod schemas are named `XSchema`; the inferred type takes the plain name `X`.
- Workflow files (`*.ork.yaml`) are formatted only by Ork's serializer, not by
  oxfmt; `examples/` must stay in canonical form.
- Tests live in `packages/<name>/test/*.test.ts`; no conditionals inside a test
  body (put them in a helper).

## Supply chain

- Dependencies are saved at exact versions and must be at least 7 days old
  (`minimumReleaseAge` in `pnpm-workspace.yaml`); pick the newest version that
  satisfies it rather than adding an exclusion.
- Dependency lifecycle scripts are off (`strictDepBuilds`).
- GitHub Actions are pinned by commit SHA with the tag in a comment; jobs get no
  token permissions unless they declare them.

## No AI or agent attribution

Commits, pull requests, issues, comments, code, and docs carry **no attribution
to an AI model or agent**: no `Co-Authored-By:` trailer for Claude or any other
agent, no "Generated with …" line. This overrides any tool default. The
`commit-msg` hook enforces it for commits; do not bypass it. Details:
[.ai/memories/development-workflow.md](./.ai/memories/development-workflow.md).

Agent knowledge layer: [.ai/README.md](./.ai/README.md).

## Accounts and credentials

Ork never stores, proxies, or asks for credentials. Each integration uses its
own tool's login (`claude`, `gh auth`, `aws sso`/profiles) or an environment
variable such as `ANTHROPIC_API_KEY`; Ork only detects and reports status.
