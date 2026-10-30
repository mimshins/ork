# Contributing to Ork

Thanks for your interest in Ork. Bug reports, ideas, documentation, and code are
all welcome.

## Code of Conduct

This project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it.

## Before you start

- **Open an issue first** for anything bigger than a small fix, so we can agree
  on scope before you write code.
- Read [docs/design.md](./docs/design.md) for the overview, the
  [specs](./specs/README.md) for what each part must do, the
  [ADRs](./decisions/README.md) for why, and the
  [interaction map](./docs/interaction-map/README.md) for how the parts fit
  together.
- An architectural change starts with a spec and, when there are real
  alternatives, an [RFC](./rfcs/README.md); see
  [AGENTS.md](./AGENTS.md#spec-driven-development).
- Report vulnerabilities privately: see [SECURITY.md](./SECURITY.md).

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
| `packages/schema`         | `@krapht/ork-schema`         | Workflow file format                      |
| `packages/core`           | `@krapht/ork-core`           | Compiler, expressions, runtime port       |
| `packages/runtime-claude` | `@krapht/ork-runtime-claude` | Claude drivers: Agent SDK and `claude`    |
| `packages/nodes`          | `@krapht/ork-nodes`          | Built-in node types                       |
| `packages/server`         | `@krapht/ork-server`         | Local HTTP + SSE API for the UI           |
| `packages/cli`            | `@krapht/ork`                | The `ork` command; the only published one |

A package may import only the packages to its left in
`schema <- core <- runtime-claude, nodes <- server <- cli`, through their public
entry point. oxlint enforces this.

## Working on code

- Follow the conventions in [AGENTS.md](./AGENTS.md#conventions): only erasable
  TypeScript syntax, `.ts` extensions on relative imports, arrow functions,
  `type` aliases, no `any`, no non-null assertions.
- Add tests next to the package (`packages/<name>/test/*.test.ts`) for every
  behaviour change. Tests never call real services or real accounts: use the
  fakes the package provides.
- A behavior change updates its spec in [specs/](./specs/README.md); a
  hard-to-reverse choice gets an ADR. Documents over 200 lines are split into a
  hub and chunks ([runbook/development/docs.md](./runbook/development/docs.md)).
- After a schema change, run `pnpm --dir packages/schema gen:json-schema` and
  commit `workflow.schema.json`.
- Keep `examples/*.ork.yaml` in canonical form; they are formatted by Ork's own
  serializer, not by oxfmt.
- When you change how parts interact, update the interaction map in the same
  pull request.
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

## Using Ork's accounts model

Ork never stores, proxies, or asks for credentials. Contributions must keep it
that way: integrations use the user's own tool login or an environment variable,
and nothing writes a secret to logs, events, artifacts, or workflow files.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
