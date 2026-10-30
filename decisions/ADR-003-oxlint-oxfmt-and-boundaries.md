# ADR-003 — oxlint and oxfmt, with package boundaries enforced by lint

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** toolchain / architecture
- **RFC:** waived — decided in design review on 2026-10-30

## Context

The maintainer asked for oxlint and oxfmt, as used in sudo-overclock and
se-client-kit. The monorepo's packages have a dependency direction that must not
erode as the engine grows: the schema knows nothing of the engine, the engine
nothing of the Claude drivers, and so on.

## Decision

1. **oxlint**, configured in TypeScript
   ([oxlint.config.ts](../oxlint.config.ts)): type-aware (`oxlint-tsgolint`),
   with the `correctness`, `suspicious`, `pedantic`, and `perf` categories as
   errors, plus the house rules (arrow functions, `type` over `interface`,
   inline type imports, no `any`, no non-null assertions, `.ts` import
   extensions, no conditionals in tests).
2. **oxfmt**, configured in TypeScript ([oxfmt.config.ts](../oxfmt.config.ts)),
   80 columns, sorted imports, prose wrapped. Workflow files (`*.ork.yaml`) are
   excluded: Ork's own serializer formats them
   ([ADR-006](./ADR-006-workflow-file-format.md)).
3. **Package boundaries by lint.** `no-restricted-imports` overrides, generated
   from one table in `oxlint.config.ts`, enforce the direction
   `schema <- core <- runtime-claude, nodes <- server <- cli`: a package imports
   only packages to its left, through their public entry point, never by a
   relative path into another package.

## Options considered

- **ESLint and Prettier.** Mature, but slower and a larger dependency tree; the
  maintainer's other repositories have moved off them.
- **Biome.** One tool for both, but not the maintainer's choice.
- **Boundaries by convention or review only.** Erodes silently.
- **oxlint and oxfmt, boundaries by lint** — chosen.

## Rationale

Both tools are fast enough to run on every save and in the pre-push hook. A
boundary that the linter enforces stays true without anyone remembering it.

## Consequences

- `pnpm check` runs `oxfmt --check`, `oxlint`, `tsc`, the tests, and the docs
  and map checks; the `pre-push` hook runs it; CI runs each as a job.
- A new package needs a row in the boundary table.
- Some rules force small rewrites (for example, multi-specifier re-exports trip
  `no-duplicate-imports`, so index files use `export *`).
