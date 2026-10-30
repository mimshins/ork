# Contributing to Ork

Thanks for your interest in Ork. Bug reports, ideas, documentation, and code are
all welcome.

## Code of Conduct

This project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it.

## Before you start

- **Open an issue first** for anything bigger than a small fix, so we can agree
  on scope before you write code.
- New to Ork as a user? The [documentation center](./docs/README.md) has the
  installation guide, a quickstart and guides. This page is for working on Ork
  itself.
- Read [docs/design.md](./docs/design.md) for the overview, the
  [specs](./specs/README.md) for what each part must do, the
  [ADRs](./decisions/README.md) for why, and the
  [interaction map](./docs/interaction-map/README.md) for how the parts fit
  together.
- Report vulnerabilities privately: see [SECURITY.md](./SECURITY.md).

## Architectural changes

A change that alters a package boundary, the workflow file format, the runtime
port, a cross-cutting pattern or a major dependency follows the spec-driven
process ([AGENTS.md](./AGENTS.md#spec-driven-development)):

1. **Task spec.** Draft it from [.ai/templates/spec.md](./.ai/templates/spec.md)
   in `.ai/specs/` (local, gitignored), and clarify it until nothing is
   ambiguous.
2. **RFC** when there are real alternatives, in [rfcs/](./rfcs/README.md)
   ([how](./.ai/skills/write-an-rfc/SKILL.md)).
3. **Tasks.** Break it into ordered, checkable tasks, and agree on them before
   writing code.
4. **ADR.** A hard-to-reverse choice, including any new runtime dependency, gets
   an ADR in [decisions/](./decisions/README.md); a shipped RFC gets one too and
   moves to `rfcs/archived/`.

Routine work, small changes and bug fixes need none of this.

## Development setup

Requirements: Node.js `>= 24.20` and pnpm (the exact version is pinned in
`package.json`; `corepack enable` picks it up).

```sh
pnpm install          # install dependencies and the git hooks
pnpm check            # format check, lint, typecheck, tests
pnpm format           # fix formatting (oxfmt)
pnpm lint:fix         # fix what oxlint can fix
pnpm test             # unit tests (vitest)
pnpm ork <command>    # run the CLI from source, e.g. `pnpm ork validate examples`
```

There is no build step for development: Node runs the TypeScript sources
directly.

`pnpm install` sets `git config core.hooksPath .githooks`:

- `pre-push` runs `pnpm check` and aborts the push on failure. CI runs the same
  gates; bypass only in an emergency with `git push --no-verify`.
- `commit-msg` rejects AI or agent attribution lines (see below).

## Project structure

| Package                   | npm name                     | Role                                      |
| ------------------------- | ---------------------------- | ----------------------------------------- |
| `packages/integrations`   | `@krapht/ork-integrations`   | Registries: CLI tools and Claude drivers  |
| `packages/schema`         | `@krapht/ork-schema`         | Workflow file format                      |
| `packages/core`           | `@krapht/ork-core`           | Compiler, scheduler, context, worktrees   |
| `packages/runtime-claude` | `@krapht/ork-runtime-claude` | Claude drivers: Agent SDK and `claude`    |
| `packages/nodes`          | `@krapht/ork-nodes`          | Built-in node types                       |
| `packages/server`         | `@krapht/ork-server`         | Local HTTP + SSE API for the UI           |
| `packages/cli`            | `@krapht/ork`                | The `ork` command; the only published one |

A package may import only the packages to its left in
`integrations <- schema <- core <- runtime-claude, nodes <- server <- cli`,
through their public entry point. oxlint enforces this.

## Working on code

- Follow the conventions in [AGENTS.md](./AGENTS.md#conventions): only erasable
  TypeScript syntax, `.ts` extensions on relative imports, arrow functions,
  `type` aliases, no `any`, no non-null assertions.
- Add tests next to the package (`packages/<name>/test/*.test.ts`) for every
  behaviour change. Tests never call real services or real accounts: use the
  fakes the package provides.
- A behavior change updates its spec in [specs/](./specs/README.md) and the user
  guide that covers it; a hard-to-reverse choice gets an ADR.
- After a schema change, run `pnpm --dir packages/schema gen:json-schema` and
  commit `workflow.schema.json`.
- Keep `examples/*.ork.yaml` in canonical form; they are formatted by Ork's own
  serializer, not by oxfmt.
- Every source file starts with a `/** @file … */` block saying what it is for
  (`pnpm lint` checks it).
- `index.ts` is only a package's entry point and only re-exports; give every
  other module a name for what it does (`pnpm lint` checks it).
- Something you find missing, or build a simpler way for now, goes in
  [specs/gaps.md](./specs/gaps.md).
- A new integration (a CLI, a Claude driver, a node type) is an adapter behind
  an interface, found through a registry, not a new branch in shared code.

## Docs, the interaction map and the roadmap

- **User docs** live in [docs/](./docs/README.md): installation, the quickstart
  and guides, written for people using Ork. A change users can see updates the
  guide that covers it, in the same pull request.
- **Contracts** live in [specs/](./specs/README.md); a spec's Status line says
  what is built.
- Documents under `specs/`, `docs/` and `runbook/` over 200 lines are split into
  a hub and chunks
  ([runbook/development/docs.md](./runbook/development/docs.md));
  `pnpm docs:check` checks links, anchors and the layout.
- When you change how parts interact, update the
  [interaction map](./docs/interaction-map/README.md) in the same pull request
  (`pnpm map` to view it, `pnpm map:check` to check it).
- When an item ships or new work is planned, update the
  [roadmap data](./docs/interaction-map/public/js/data/roadmap.js)
  ([how](./docs/interaction-map/roadmap.md)).
- New dependencies must be justified in the pull request, saved at an exact
  version, and at least 7 days old (the workspace refuses newer ones).

## Commits and pull requests

- One logical change per pull request, with a short imperative title.
- Commit messages: a short imperative subject line, a blank line, then what
  changed and why.
- **No AI or agent attribution**, anywhere: no `Co-Authored-By:` trailer for
  Claude or any other model or agent, and no "Generated with …" line in commits,
  pull request descriptions, issues, or comments. You are welcome to use AI
  tools, but you are the author and you are responsible for the change.
- Add a changeset when you change shipped code: `pnpm changesets:create` (patch
  or minor on `0.x`), or `pnpm changesets:empty` for docs, tests and tooling. CI
  checks it. Releases are automated
  ([runbook/development/release.md](./runbook/development/release.md)).
- Fill in the pull request template; `pnpm check` must pass.

### Pull request flow

1. Fork the repository, or branch from `main` if you have access.
2. Make the change with its tests, specs, docs and changeset.
3. Run `pnpm check` (the `pre-push` hook runs it too).
4. Open the pull request against `main`. CI runs the same checks plus the
   changeset check; a maintainer reviews it.
5. Once merged, the release workflow collects the changesets into a release pull
   request.

## Using Ork's accounts model

Ork never stores, proxies, or asks for credentials. Contributions must keep it
that way: integrations use the user's own tool login or an environment variable,
and nothing writes a secret to logs, events, artifacts, or workflow files.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
