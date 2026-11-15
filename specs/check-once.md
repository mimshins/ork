# Check once: never re-run a passed check on the same files

Status: **Built**: `ork once` (with `--on`, to key a check by some files),
`once: true` on a `verify:` and on a tool node, the `verify.skipped` event, and
this repository's `pnpm check` and `pnpm check:changed` through it, with the
test step keyed by the files tests read, and `pnpm check:quick`. The suite
itself is cheaper (below), and a build measured again spent about 75% less on
checks ([numbers](../benchmarks/method.md#a-build-measured-again)). Not measured
yet: the suite under 200 CPU-s on an idle machine
([L269](./gaps/check-once-limits.md)). Code:
[key](../packages/core/src/once/key.ts),
[run](../packages/core/src/once/run.ts),
[store](../packages/core/src/once/store.ts),
[CLI](../packages/cli/src/commands/once.ts),
[nodes](../packages/nodes/src/tool-command.ts)
([core tests](../packages/core/test/once.test.ts),
[CLI tests](../packages/cli/test/once.test.ts),
[node tests](../packages/nodes/test/once.test.ts),
[schema tests](../packages/schema/test/once.test.ts)). Why:
[ADR-082](../decisions/ADR-082-check-once-keyed-by-files.md) and, for `--on`,
[ADR-092](../decisions/ADR-092-check-once-on-pathspecs.md).

A full check costs about 600 CPU-s on a loaded machine. Much of a build run's
checks were on files already checked: a docs node that edited nothing, a publish
step after a leader's round on the same files, Ork's `verify:` after an agent's
own passing run, the pre-push hook on a tree a run had just checked. This spec
is how a passed check is skipped, and how the suite itself costs less. The
user's side is
[running several runs at once](../docs/guides/running-workflows/several-runs.md#run-a-check-once-ork-once).

## Contents

- [The command](#the-command)
- [The key](#the-key)
- [Where passes are kept](#where-passes-are-kept)
- [In a workflow](#in-a-workflow)
- [In this repository](#in-this-repository)
- [A cheaper suite](#a-cheaper-suite)

## The command

```
ork once [--as <name>] [--covers <name>]… [--on <pathspec>]… [--with-head] [--force] -- <command…>
```

It runs the command (with the terminal's output and its exit code as its own)
unless the same check already passed on identical files, and records a pass when
the command exits 0 and the files are the same after it ran as before.

- A hit prints one line and exits 0:
  `✓ check already passed on these files · <when> · <run/node or "you">`.
- `--as` names the check (default: the command's text). `--covers` records the
  pass for other names too, so a full check covers a quicker one. `--with-head`
  adds `HEAD` to the key, for a check relative to it, such as
  `vitest --changed`.
- `--on` (repeatable) lists the git pathspecs, relative to the current folder,
  that the check depends on; only the files they match key the pass, so an edit
  elsewhere still hits. Pathspec magic works (`--on . --on ':(exclude)docs'`).
  Git rejecting one is a usage error (exit 1, git's message) and the command
  does not run: never a silent hit. `--covers` and `--on` may each be given
  several times (the CLI reads every use, not only the last).
- `--force` and `ORK_ONCE=off` run the command anyway (and record a pass after
  `--force`). A failing command records nothing. Outside a git repository the
  command always runs.
- Everything after `--` is the command: its own flags are never Ork's. With
  nothing after `--` it is a usage error (exit 1). So `-h` or `--help` after
  `--` belongs to the wrapped command; one before `--` shows Ork's help. Who ran
  it is `<run>/<node>` when `ORK_RUN` and `ORK_NODE` are set, `you` otherwise.

## The key

A pass is found by the working tree's files, the check's name and Node's
version, and, with `--with-head`, `HEAD`:

- **The files** are a git tree: Ork copies the real index to a temporary one,
  runs `git add -A` and `git write-tree` on it, so tracked and untracked files
  count, ignored ones (`node_modules`, build output) do not, the lockfile does,
  and the real index is untouched. Git hashes only the files whose stat changed.
- **With `--on`,** the key is the files the pathspecs match, not the whole tree:
  after `git add -A` on the temporary index, Ork hashes (sha256) the output of
  `git ls-files -s -z --full-name -- <pathspecs>` run against it. So tracked and
  untracked files count, ignored ones do not, a deleted file changes the
  listing, and the stat cache is kept. The hash is stored in the pass's `tree`
  field, and the pass's file name hashes `[name, files, node, on]`, so a
  different list never shares a pass. Without `--on` the name is hashed as
  before, so earlier passes stay valid. A git failure on the pathspecs, or
  pathspecs that match no file (a key on nothing would hit for ever after the
  first run), rejects (`OncePathspecError`) before the command runs. `--on` or
  `--covers` with no value (`--on --force`) is refused too, never read as the
  next flag. The key taken after the run swallows errors and records nothing, as
  for any key that changed.
- **The key is the files, not the commit.** A commit, or a rebase that changes
  no file, keeps a hit. Nothing is assumed from a parent tree.
- A pass counts only for the files it ran on: an edit while the command ran
  records nothing.

## Where passes are kept

In `<git-common-dir>/ork-once/`, one JSON file per name, files and Node version,
written whole (a temporary file, then a rename). It holds the tree, `HEAD`, the
time, the Node version, the name and who ran it, nothing else. The folder is
shared by every worktree of the repository and is outside all of them, so a
session's file edits do not reach it. Passes older than 7 days, or past the
newest 500, are removed when a pass is written, as is a file that does not read
as a pass.

## In a workflow

`once: true` on a `verify:` and on a tool node
([format](./workflow-format/node-types.md)) makes Ork wrap the command the same
way: the name is the command as the run shows it (a `script:`'s text is part of
it), `who` is `<run>/<node>`, and a `ORK_ONCE=off` in the node's environment
always runs it. A skipped check ends as a pass with exit code 0 and empty
output, and the run records `verify.skipped` (`check`, `at`, `who`), which
`ork logs` and the UI show as one line
([events](./scheduler/resuming-and-events.md)). Without `once`, the same as
before. Old files mean the same; `schemaVersion` does not change.

## In this repository

- `pnpm check` is
  `ork once --as check --covers check:changed -- pnpm run check:all`, and
  `pnpm check:changed` is
  `ork once --as check:changed --with-head -- pnpm run check:changed:run`. The
  pre-push hook, an agent's own run, `verify:` and the publish step all call
  them, so one pass serves all.
- Inside `check:all`, the `test` step is wrapped too:
  `ork once --as tests --on . --on ':(exclude)…' -- pnpm run test`. A docs-only
  edit still misses the outer `check` (it keys on the whole tree), so the static
  checks (format, lint, types, docs, map, benchmarks) rerun, and the tests print
  the "already passed" line; an edit under `packages/` reruns them. The list is
  an **exclude** list, so a new folder reruns the tests: `specs`, `decisions`,
  `rfcs`, `runbook`, `benchmarks`, `.changeset`, most of `docs` (not the guides
  two tests read, and not the `docs/guides` entries starting with `i` or `w`),
  and the root READMEs and policy files. The exact list is in `package.json`. A
  test run fails when a test reads a path the list leaves out
  ([read-guard.ts](../tools/vitest/read-guard.ts) records each test worker's
  reads of the repository through `node:fs`,
  [read-guard-check.ts](../tools/vitest/read-guard-check.ts) asks git which the
  pathspecs keep when the run ends), so the list can't go stale
  ([L375 and L377](./gaps/check-once-limits.md)).
- `pnpm check:quick` ([tools/check/quick.ts](../tools/check/quick.ts)) is the
  loop between edits: `oxfmt --check` and `oxlint` on the files changed since
  `HEAD` (and untracked ones), then both typechecks. It never records a pass and
  can pass what `check:fast` fails ([L376](./gaps/check-once-limits.md)).
- CI has no cache (a fresh checkout) and runs the checks it names one by one;
  the canary release runs `pnpm run check:all`.
- `build` runs the full suite once, in its publish `check`, on the rebased tree
  that lands. Its leader and `polish` verify with `pnpm check:changed` (the
  tests the change reaches), as the builders do, and its docs node with
  `pnpm check:static` (`check:fast` plus the map and benchmarks checks, no
  tests). Before, the leader each round and `polish` ran the full check too:
  four full suites in a row near a build's end, 150 to 250 seconds each (six
  builds on 2026-11-12 and 13), because each step had changed a file or two
  since the last pass. A failure only the full suite finds now shows at publish,
  where `repair` takes it.
- Those `verify:` steps do not set `once: true`: the scripts already go through
  `ork once`, and wrapping them again would key the same files twice.

## A cheaper suite

Changes to the suite that alter no test's meaning:

- vitest uses a third of the cores always, not only inside a run: more workers
  used more CPU for the same tests, and runs share the machine
  ([machine](./machine.md#around-a-run)).
- The Node tests' child Node processes share one compile cache
  (`tools/vitest/compile-cache.ts`), so a CLI start compiles each module once.
- Tests that waited on real time use fake timers with the same assertions
  (`timeouts`, `watch`, `holds`); the walk fuzz tries 100 workflows locally and
  500 where `CI` is set (`ORK_FUZZ_COUNT` sets another number); the worktree
  tests and the `issues` example's world copy one fixture repository per worker
  instead of `git init` for each.
- The UI project's files share one module graph and jsdom window per worker
  (`isolate: false`, `unstubGlobals: true`): its wall time went from 35 to 15 s
  and its CPU from about 160 to 50 s. No UI test mocks a module; a file's
  leftovers (a frame, a timer, DOM) must not outlive its tests.

The numbers, and what was not measured, are in
[the suite's cost](../benchmarks/method.md#the-suites-cost). What is left:
[L267 and L268](./gaps/check-once-limits.md).
