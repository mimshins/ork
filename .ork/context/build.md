# Building in the `build` workflow

Every node of `build` reads this file (`layers.context` in
`.ork/workflows/build.ork.yaml`), after the project's
[session rules](./sessions.md).

- **A design decision** is anything AGENTS.md says needs an ADR (a package
  boundary, the workflow format, the runtime port, a cross-cutting pattern, a
  new runtime dependency) or anything that changes what users see. Your prompt
  says what you do with one the plan doesn't settle; no node decides one for the
  maintainer.
- **The suites are Ork's to run.** `pnpm check`, `pnpm check:changed`,
  `pnpm test` and a bare `vitest run` are denied to a node with a check, and Ork
  runs that check before its report counts. While you work, use
  `pnpm check:fast` (format, lint, typecheck, docs) and targeted
  `vitest run <files>`. The check on a node is `pnpm check:changed` (the tests
  its change reaches), or `pnpm check:static` on `docs` (no tests); the full
  suite runs once, before the push.
