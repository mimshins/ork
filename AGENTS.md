# AGENTS.md

Ork is a local, open-source orchestration harness for Claude agents: a workflow
of hierarchical agent and tool nodes, designed in a CLI or a localhost UI,
serialized to git-friendly YAML, and run on the user's own machine with the
user's own accounts. See [README.md](./README.md), the overview in
[docs/design.md](./docs/design.md), and the contracts in
[specs/](./specs/README.md).

AI knowledge layer: [.ai/README.md](./.ai/README.md).

**This repository is public.** Everything committed here, including issues and
pull requests, is world-readable. Never commit credentials, tokens, or personal
data.

## Layout

| Package                   | npm name                     | Role                                                    |
| ------------------------- | ---------------------------- | ------------------------------------------------------- |
| `packages/integrations`   | `@krapht/ork-integrations`   | Registries: one adapter per CLI tool and Claude driver  |
| `packages/schema`         | `@krapht/ork-schema`         | Workflow file format: Zod model, JSON Schema, YAML      |
| `packages/core`           | `@krapht/ork-core`           | Compiler, expressions, runtime port, scheduler, context |
| `packages/runtime-claude` | `@krapht/ork-runtime-claude` | The Agent SDK and headless `claude` CLI drivers         |
| `packages/nodes`          | `@krapht/ork-nodes`          | Built-in node types                                     |
| `packages/server`         | `@krapht/ork-server`         | Local HTTP + SSE API (milestone 2)                      |
| `packages/cli`            | `@krapht/ork`                | The `ork` command, the only published package           |

Dependency direction (enforced by `oxlint.config.ts`):
`integrations <- schema <- core <- runtime-claude, nodes <- server <- cli`.
Import other packages through their public entry point (`@krapht/ork-<name>`),
never by relative path.

## Spec-driven development

For an **architectural or design change** (one that alters a package boundary,
the workflow file format, the runtime port, a cross-cutting pattern, a major
dependency, or otherwise involves real trade-offs):

1. **Require a task spec.** Draft it from
   [.ai/templates/spec.md](./.ai/templates/spec.md) in `.ai/specs/` (local,
   gitignored) for the author to edit.
2. **Clarify** until no ambiguity is left.
3. **RFC** when there are real alternatives
   ([write-an-rfc](./.ai/skills/write-an-rfc/SKILL.md)).
4. **Task breakdown** into ordered, checkable tasks.
5. **Confirm** with the author before writing code.

The author may waive the RFC for a decision they make directly; the ADR then
records the waiver and the options considered. Routine work, small changes and
bug fixes need no spec unless they are architectural.

## Mandatory actions

- **Keep specs true.** A behavior change updates its spec in `specs/` in the
  same change; a spec's Status line says what is built.
- **Keep the user docs true.** A change users can see updates its guide in
  [docs/](./docs/README.md) (installation, quickstart, guides) in the same
  change; the README stays a short entry point that links to them.
- **Record decisions.** A hard-to-reverse choice (including any new runtime
  dependency) gets an ADR in [decisions/](./decisions/README.md); an RFC that
  ships gets one too, and moves to `rfcs/archived/`.
- **Follow the docs layout.** A document under `specs/`, `docs/` or `runbook/`
  over 200 lines is a hub plus chunks
  ([runbook/development/docs.md](./runbook/development/docs.md),
  [docs-structure](./.ai/skills/docs-structure/SKILL.md)).
- **Add a changeset** for any change to shipped code: `pnpm changesets:create`,
  or `pnpm changesets:empty` for internal-only work
  ([runbook/development/release.md](./runbook/development/release.md)).
- **Sync knowledge before handing off:** run
  [knowledge-drift-sync](./.ai/skills/knowledge-drift-sync/SKILL.md). A change
  that leaves specs, ADRs, the interaction map or memories stale is incomplete.
- **Verify:** `pnpm check` passes.

## Where things live

| Topic                                  | Location                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| User docs: install, quickstart, guides | [docs/](./docs/README.md)                                 |
| Contributor guide                      | [CONTRIBUTING.md](./CONTRIBUTING.md)                      |
| Overview, milestones                   | [docs/design.md](./docs/design.md)                        |
| Contracts: what each part does         | [specs/](./specs/README.md)                               |
| Accepted decisions and why (ADRs)      | [decisions/](./decisions/README.md)                       |
| Proposals (RFCs)                       | [rfcs/](./rfcs/README.md)                                 |
| Procedures: docs, releases             | [runbook/](./runbook/development/release.md)              |
| How the parts fit together             | [docs/interaction-map/](./docs/interaction-map/README.md) |
| Agent orientation, skills, templates   | [.ai/](./.ai/README.md)                                   |
| Local-only task specs (gitignored)     | `.ai/specs/`                                              |

## Commands

- `pnpm check` runs format check, lint, typecheck, tests, the docs check and the
  map check; it must pass before a push (the `pre-push` hook runs it).
- `pnpm docs:check` checks links, anchors and the hub/chunk layout.
- `pnpm build` bundles the CLI into `packages/cli/dist/bin.mjs`.
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
([sync.md](./docs/interaction-map/sync.md)). The **roadmap** page beside it
(`roadmap.html`) tracks milestones and what shipped; when an item ships or new
work is planned, update
[its data](./docs/interaction-map/public/js/data/roadmap.js) too
([roadmap.md](./docs/interaction-map/roadmap.md)).

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
- Every source file starts with a JSDoc `/** @file … */` block saying what the
  module is for (`pnpm lint` checks it: `tools/lint/file-overview.ts`).
- Extensible by design: a new integration (a CLI such as GitLab or GCP, a Claude
  driver, a node type) is an adapter behind an interface, found through a
  registry, not a new branch in shared code.

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
