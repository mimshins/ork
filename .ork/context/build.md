# Building in the `build` workflow

Every node of `build` reads this file (`layers.context` in
`.ork/workflows/build.ork.yaml`), after the project's
[session rules](./sessions.md).

- **A design decision** is anything AGENTS.md says needs an ADR (a package
  boundary, the workflow format, the runtime port, a cross-cutting pattern, a
  new runtime dependency) or anything that changes what users see. Your prompt
  says what you do with one the plan doesn't settle; no node decides one for the
  maintainer.
- **Read through `extract`, not the shell.** Implement and review nodes: for a
  line range, a search or a diff, call the `extract` tool instead of `cat`,
  `sed`, `rg`, `git diff` or a whole-file read. Only the extract enters the
  conversation, and every later turn rereads what is in it. Example:
  `extract({ steps: [{ step: "git", op: "diff", base: "main" }, { step: "match", text: "harness", context: 3 }] })`.
  Step shapes: `read` (`path`, `from`, `to`), `search` (`pattern`, `path`,
  `ignoreCase`, `maxMatches`), `git` (`op` of `diff`, `show` or `log`), then the
  cuts `head`, `tail` and `match`. A cut result says how to page with `from`.
- **The suites are Ork's to run.** `pnpm check`, `pnpm check:changed`,
  `pnpm test` and a bare `vitest run` are denied to a node with a check, and Ork
  runs that check before its report counts. While you work, use
  `pnpm check:quick` between edits (format and lint on the files you changed,
  then the typecheck) and `pnpm check:fast` (format, lint, typecheck, docs) as
  the pass before a report, with targeted `vitest run <files>`. `check:quick`
  can pass what `check:fast` fails: the docs, map and benchmarks checks, and an
  unchanged file whose lint depends on a changed one. The check on a node is
  `pnpm check:changed` (the tests its change reaches), or `pnpm check:static` on
  `docs` (no tests); the full suite runs once, before the push.
