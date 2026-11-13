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
- New to the code? [ONBOARDING.md](./ONBOARDING.md) is an ordered path through
  the docs, the interaction map and the packages.
- Read [specs/design.md](./specs/design.md) for the overview, the
  [specs](./specs/README.md) for what each part must do, the
  [ADRs](./decisions/README.md) for why, and the
  [interaction map](./docs/interaction-map/README.md) for how the parts fit
  together.
- Report vulnerabilities privately: see [SECURITY.md](./SECURITY.md).

## Architectural changes

A change that alters a package boundary, the workflow file format, the runtime
port, a cross-cutting pattern or a major dependency follows the spec-driven
process ([AGENTS.md](./AGENTS.md#spec-driven-development)):

1. **Plan.** Draft it from [.ai/templates/plan.md](./.ai/templates/plan.md) in
   `.ai/plans/` (local, gitignored), and clarify it until nothing is ambiguous.
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
pnpm check            # format check, lint, typecheck, tests, docs and map checks (skipped when they already passed on the same files)
pnpm check:fast       # format, lint, typecheck and docs only
pnpm check:static     # check:fast plus the map and benchmarks checks: everything but the tests
pnpm format           # fix formatting (oxfmt)
pnpm lint:fix         # fix what oxlint can fix
pnpm test             # unit tests (vitest)
pnpm ork <command>    # run the CLI from source, e.g. `pnpm ork validate examples`
```

There is no build step for development: Node runs the TypeScript sources
directly.

`pnpm install` sets `git config core.hooksPath .githooks`:

- `pre-push` runs `pnpm check` and aborts the push on failure. `pnpm check` and
  `pnpm check:changed` go through [`ork once`](./specs/check-once.md): a check
  that already passed on identical files is skipped
  (`pnpm ork once --force -- …` or `ORK_ONCE=off` runs it anyway;
  `pnpm check:all` always runs). CI has no cache and runs the same gates; bypass
  only in an emergency with `git push --no-verify`.
- `commit-msg` rejects AI or agent attribution lines (see below).

## Project structure

| Package                 | npm name                   | Role                                      |
| ----------------------- | -------------------------- | ----------------------------------------- |
| `packages/integrations` | `@krapht/ork-integrations` | Registries: CLI tools and agent drivers   |
| `packages/schema`       | `@krapht/ork-schema`       | Workflow file format                      |
| `packages/core`         | `@krapht/ork-core`         | Compiler, scheduler, context, worktrees   |
| `packages/runtime`      | `@krapht/ork-runtime`      | The agent drivers (`claude-code` first)   |
| `packages/nodes`        | `@krapht/ork-nodes`        | Built-in node types                       |
| `packages/server`       | `@krapht/ork-server`       | Local HTTP + SSE API for the UI           |
| `packages/ui`           | `@krapht/ork-ui`           | The browser UI, built into the CLI        |
| `packages/cli`          | `@krapht/ork`              | The `ork` command; the only published one |

A package may import only the packages to its left in
`integrations <- schema <- core <- runtime, nodes <- server <- ui, cli`, through
their public entry point. oxlint enforces this.

## Working on code

- Follow the conventions in [AGENTS.md](./AGENTS.md#conventions): only erasable
  TypeScript syntax, `.ts` extensions on relative imports, arrow functions,
  `type` aliases, no `any`, no non-null assertions.
- Add tests next to the package (`packages/<name>/test/*.test.ts`) for every
  behaviour change. Tests never call real services or real accounts: use the
  fakes the package provides. A test that waits on time uses a fake clock, not a
  real wait, and one that needs a git repository copies a shared fixture where
  there is one ([check once](./specs/check-once.md#a-cheaper-suite)).
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
- A new integration (a CLI, an agent driver, a node type) is an adapter behind
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

## Running Ork's own workflows

This repository is an Ork project: [.ork/project.yaml](./.ork/project.yaml)
holds its rules, and [.ork/workflows/](./.ork/workflows) its workflows. Each of
`rfc`, `plan` and `build` also runs alone
([ADR-072](./decisions/ADR-072-start-gateway.md)).

- **`start`** is the way in. It reads your brief, the saved plans and the active
  RFCs, recommends a route, and you choose: a new plan, a new RFC first, a plan
  from an Accepted RFC, or building a saved plan. It then calls the workflows
  that route needs. A foreground `start` shows the called runs and asks their
  questions on its own terminal; a detached one leaves them for `ork attach`,
  `ork decide` or the Decisions panel of `ork ui`.
- **`rfc`** weighs real options against the code, asks you to pick each outcome,
  and ends at a gate that publishes the RFC. Only an RFC on `main` goes on to a
  plan.
- **`plan`** asks you each open design decision, one at a time, and the
  spec-writer drafts the plan for you to approve. An approved plan is saved in
  `.ai/plans/`, named by the `name` input or the run's id, and never replaces
  one already there.
- **`build`** takes an approved plan. A leader builds it through the agents it
  owns: the ui-designer and the a11y-auditor for UI work, the implementer, or
  the engine agent for engine work, until `pnpm check` passes. A design decision
  the plan doesn't settle comes to you. Three independent reviewers, one each
  for correctness, tests and repository rules, send findings back for up to two
  more rounds, and a `followups` step lists what the change leaves for later and
  asks you once (take its recommendation, defer all, or choose each): the small
  agent ones are done in one more round, with its own review, and the rest are
  recorded as [follow-ups](./docs/guides/follow-ups.md) once the change is
  published (the plan's optional `Follow-ups` section lists the ones you already
  know). You ratify the decisions made, the docs-keeper syncs the knowledge,
  adds any missing changeset and drafts the commit message, and a last gate asks
  where the change goes. Answer `branch` with a note naming your branch to push
  there and open a pull request (no note: `ork/<run>`). `main` is the
  maintainer's; `keep-uncommitted` applies it to your checkout, and `discard`
  leaves it in the worktree. The commit refuses a change with no changeset.
- **`qa-pass`** splits the scope into up to 8 surfaces and has one qa agent test
  each, on the package built from `main`, as a user would, with a fake `claude`
  and `gh`. Each tester sets itself up with the QA kit
  (`node tools/qa/kit.ts setup <tarball> <name>`: a temp root with its own
  `HOME`, an install prefix, the stand-ins and a committed starter repo),
  commits in a throwaway repo only through `kit.ts commit`, and ends with
  `kit.ts stop`. Because the `ork` store of its `HOME` is not one the run
  guards, a tester can open `ork ui` and answer `ork decide` on its own
  throwaway runs (the real store stays guarded). A `sweep` step then stops
  anything left, in every tester's root, and removes pack's folder (only a
  folder under the temp dir that holds a kit root or a `.tgz`, so it still goes
  when every tester failed before setup), whether the testers passed or failed.
  It shows you what every surface found, and says which failed.
- **`audit`** audits the repository's security: free scanners first
  (`pnpm audit`, the workflows' pinning and permissions, secret patterns), then
  the security-audit skill's phases as read-only nodes (recon, one hunter per
  unit, a critic, a fresh verifier per candidate, a recheck under `standard`).
  `quick` (the default) costs at most $29 and is a partial pass; `standard` at
  most $72. The report stays outside the checkout, in `~/.ork/audits`, and is
  never committed or posted: see the
  [runbook](./runbook/development/security-audit.md).

Run them with a released Ork installed globally (`1.0.0-alpha.0` or later), not
with `pnpm ork` from this checkout. A run starts more `ork` processes as it goes
(detached and called runs, `ork ui`'s server), and from source each would run
whatever is on disk at that moment, your half-finished edits included. A release
stays put while you work, and it's what users run. Keep `pnpm ork` for trying
unreleased changes on purpose; the builders inside a run still use their own
worktree's source for `pnpm check`.

```sh
pnpm add --global @krapht/ork                  # or: npm install --global @krapht/ork
ork validate                                   # check them and walk every way through them
ork run start --input brief="Let ork ps filter by workflow"
ork run qa-pass --input scope="the quickstart and the worktrees guide"
```

**Approving the plan.** `plan`'s gate shows the plan and asks `approve`,
`revise` or `stop`. To ask for changes, answer `revise` with a note saying what
to change: in the Decisions panel's note box, at the run's terminal, or from
another terminal:

```sh
ork decide <run> --id <decision> --choose revise --say "Also cover ork ps --json, and drop task 4"
```

The spec-writer resumes its session with your words and shows you the revised
plan at the same gate, for as many rounds as it takes (Ork asks you after ten).
Nothing is built, and the build's cost isn't spent, until you approve.

**Decisions become ADRs.** What you settle while planning goes in the plan's
Decided section. Each builder reports the choices it made that the plan didn't
settle (a report without them fails), the leader gathers them all, and the
`ratify` gate shows them to you. The docs-keeper writes an ADR in
[decisions/](./decisions/README.md) for each hard-to-reverse one, and the last
gate lists those ADRs, so you check them before you keep the change.

- **Runs are paid.** Each session spends on your own account, through the driver
  that's ready on your machine (your `claude` login or an API key; `ork run`
  says which). Each session has a budget, each run a cap (`start` $70, `build`
  $50, `qa-pass` $14, `audit` at most $29 or $72) and the project a daily quota
  ($100). Runs are measured for Ork's [benchmarks](./benchmarks/README.md), so
  start them only on the maintainer's go and keep their run ids
  (`ork tree <run>`, `ork usage`).
- **Ork commits nothing here.** The work stays uncommitted in a worktree beside
  your clone. When you keep it, the gate's next step applies it to your
  checkout, uncommitted, and you commit and push it as below.
- **Commit your instructions first:** `ork run` stops while `CLAUDE.md`,
  `AGENTS.md` or `.claude/` have uncommitted changes.

## Commits and pull requests

- One logical change per pull request, with a short imperative title.
- Commit messages: a short imperative subject line, a blank line, then what
  changed and why.
- **No AI or agent attribution**, anywhere: no `Co-Authored-By:` trailer for
  Claude or any other model or agent, and no "Generated with …" line in commits,
  pull request descriptions, issues, or comments. You are welcome to use AI
  tools, but you are the author and you are responsible for the change.
- Add a changeset when you change shipped code: `pnpm changesets:create` (patch
  or minor; while Ork is in alpha every release is the next `1.0.0-alpha.N`), or
  `pnpm changesets:empty` for docs, tests and tooling. CI checks it. Releases
  are automated
  ([runbook/development/release.md](./runbook/development/release.md)).
- Fill in the pull request template; `pnpm check` must pass.

### Pull request flow

1. Fork the repository, or branch from `main` if you have access.
2. Make the change with its tests, specs, docs and changeset.
3. Run `pnpm check` (the `pre-push` hook runs it too).
4. Open the pull request against `main`. CI runs the same checks plus the
   changeset check; a maintainer reviews it.
5. Once merged, CI's release job collects the changesets into a release pull
   request.

## Using Ork's accounts model

Ork never stores, proxies, or asks for credentials. Contributions must keep it
that way: integrations use the user's own tool login or an environment variable,
and nothing writes a secret to logs, events, artifacts, or workflow files.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
