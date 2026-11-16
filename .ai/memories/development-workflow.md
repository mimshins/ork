# Development workflow

## No AI or agent attribution — anywhere

Commits, pull requests, issues, review comments, code, comments in code, docs,
and changelogs carry **no attribution to an AI model or agent**. In particular:

- no `Co-Authored-By:` trailer naming Claude, another model, or any agent or bot
  (for example `Co-Authored-By: Claude … <noreply@anthropic.com>`);
- no "Generated with Claude Code" (or any other tool) line or badge in a pull
  request description, issue, or comment;
- no "written by AI" notes in code, docs, or commit messages.

This rule overrides any tool default that adds such lines. The author of a
commit is the human who made it.

**Why:** the maintainer wants the history and the project's public surface to
credit people only.

**Enforced by:** `.githooks/commit-msg`, which rejects a commit message with an
AI or agent attribution line. Do not bypass it with `--no-verify`.

## Quality gate

- `pnpm check` (format, lint, typecheck, tests, the docs check and the map
  check) passes before every push; the `pre-push` hook runs it.
- Commit messages: a short imperative subject line, a blank line, then what
  changed and why.

## Traps

- A zod field that core types as optional (such as `description` against core's
  `Described`) uses `.exactOptional()`, not `.optional()`: `.optional()` does
  not compile under `exactOptionalPropertyTypes`. The JSON Schema still lists it
  as optional.
- The 300-line lint limit bites `packages/core/src/runtime/types.ts`,
  `packages/nodes/src/claude.ts` and `packages/ui/src/panels/logs-model.ts`: a
  change there goes into a new module (`description.ts`, `claude-plan.ts`,
  `session-line.ts`), not the file.
- citty turns an unknown flag into a boolean and pushes its value into `_`, so
  on a command with `refuseExtraArguments` but not `refuseUnknownFlags`,
  `--bogus value` fails as "Unexpected argument `value`." Test the unknown-flag
  path with `orkRaw`, not a plain call.
- citty keeps only the last value of a repeated flag, so repeated `--on` and
  `--covers` are read from the raw args (`packages/cli/src/commands/once.ts`).
- `oxfmt` exits 2 when every given file is ignored, unless
  `--no-error-on-unmatched-pattern` is passed (`tools/check/quick.ts`).
- `client.call` turns a rejected fetch into `{ok:false, error:"No answer: …"}`,
  the same path as an HTTP 500, so one failed-read test covers both.
- oxlint's `max-dependencies` of 10 is why `feedback.ts` wires the plugin as
  `{...cmd, plugins}` and `useDecisionsRead` holds the read-failure check; put
  new imports in a sibling module rather than raising the limit.
- A test that picks a run with `store.runs()[0]` depends on store order; select
  the run by id.
- Tests of following several runs in store order (`followRuns`,
  `ork decide --follow`, `ork attach`, `ork logs -f --all`) put both runs'
  events in one read: polling the runs apart made the decision tests flaky
  (about 1 in 4), since the hold window releases the first poll's events alone.
  Each file keeps its own `at`-stamping store wrapper, because a shared fixture
  would pass the 10-import lint limit.
