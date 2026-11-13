# Check once: never re-run a passed check on the same files

Status: **Built**: `ork once`, `once: true` on a `verify:` and on a tool node,
the `verify.skipped` event, and this repository's `pnpm check` and
`pnpm check:changed` through it. The suite itself is cheaper (below), and a
build measured again spent about 75% less on checks
([numbers](../benchmarks/method.md#a-build-measured-again)). Not measured yet:
the suite under 200 CPU-s on an idle machine
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
[ADR-082](../decisions/ADR-082-check-once-keyed-by-files.md).

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
ork once [--as <name>] [--covers <name>]… [--with-head] [--force] -- <command…>
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
  tests copy one fixture repository per worker instead of `git init` for each.

The numbers, and what was not measured, are in
[the suite's cost](../benchmarks/method.md#the-suites-cost). What is left:
[L267 and L268](./gaps/check-once-limits.md).
