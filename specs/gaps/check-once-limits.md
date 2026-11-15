# Limits found building check once

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building [check once](../check-once.md) (a check runs once per set of
files, [ADR-082](../../decisions/ADR-082-check-once-keyed-by-files.md)) and the
cheaper suite beside it. What was left simpler:

- **L263 · A skipped tool node has no `json` output.** A tool node with
  `once: true` and `output.format: json` that is skipped ends as a pass with
  empty `stdout` and no parsed `json`, so a later node reading
  `{{nodes.x.output.json}}` gets nothing. Use `once` on checks, not on a node
  whose output feeds others.
- **L264 · `once` with `watch:` is accepted and means nothing.** A watching tool
  node repeats its command until a condition holds; a pass on the files says
  nothing about the source it looks at. `ork validate` does not warn.
- **L265 · A node's `env:` values are not in the key.** Two runs of the same
  command on the same files with different `env:` share a pass. The names the
  check reads from outside the files are the project's choice of what to wrap;
  `--force` runs it anyway.
- **L266 · The compile cache lives in the test run's temp `HOME`.** It is
  removed at exit, so every full run starts cold and pays the first compile of
  each module. A cache kept between runs would be keyed by Node's and Ork's
  versions.
- **L267 · Some tests still wait on real time or build their own repository.**
  The heavy-slot tests and the streams, control and heavy-hook tests wait on
  real clocks, and the CLI and server fixtures make a repository per test (the
  `issues` example's now copies one; `once.test.ts` was measured and saves about
  4%, so it stays).
- **L268 · The UI's jsdom environment still starts per file.** The UI project
  shares one module graph and window per worker (`isolate: false`; wall 35 to 15
  s, CPU about 160 to 50 s,
  [numbers](../../benchmarks/method.md#the-ui-project-before-and-after-sharing-the-dom)),
  but Vitest still sets the environment up for each file (about half of the wall
  time left). A file that leaves DOM, a global or a timer behind can break the
  next one in its worker; nothing checks for it except the shuffled run.
- **L269 · The suite is not measured idle.** On a loaded 12-core machine the
  full suite went from 571 to 303 CPU-s
  ([numbers](../../benchmarks/method.md#the-suites-cost)); the plan's target,
  under 200 CPU-s on an idle machine, needs an idle machine. A build measured
  again cut its checks by about 75%
  ([numbers](../../benchmarks/method.md#a-build-measured-again)). Carried,
  unplanned.
- **L270 · A path marked `assume-unchanged` or `skip-worktree` is not hashed
  again.** The key starts from a copy of the real index, so an edit to such a
  path can give a false hit.
- **L271 · The key leaves loose objects behind.** `git add -A` into the
  temporary index writes the changed files as unreachable loose objects, which
  stay until `git gc` removes them.
- **L374 · Nothing enforces the tests' exclude list.** The `--on` list on
  `check:all`'s test step was audited against the tests as they are
  ([spec](../check-once.md#in-this-repository)); a test added later that reads
  an excluded path (`specs/`, `decisions/`, a root README, most of `docs/`)
  would be skipped wrongly on an edit there. A follow-up is open to add a check
  that fails when a test file reads one.
- **L375 · The `docs/guides` carve-out is a glob.** Two tests read a guide, and
  a pathspec exclude cannot put one file back, so the list excludes the guides
  whose names start with another letter than `i` or `w` (`docs/guides/[!iw]*`).
  A new guide starting with `i` or `w` stays in the tests' key and an edit to it
  reruns the tests; it is safe, only slower.
- **L376 · `check:quick` can pass what `check:fast` fails.** It skips the docs,
  map and benchmarks checks, and checks only the files that changed, so a lint
  error in an unchanged file that depends on a changed one shows later. It never
  records an `ork once` pass. Its typecheck is not incremental: the gain was not
  measured to be worth a `tsbuildinfo` and a false pass.
