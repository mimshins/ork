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
  real clocks, and the CLI and server fixtures make a repository per test.
- **L268 · The UI's jsdom setup is not reduced.** Its files still pay jsdom's
  start for each.
- **L269 · The savings are not fully measured.** On a loaded 12-core machine the
  full suite went from 571 to 303 CPU-s
  ([numbers](../../benchmarks/method.md#the-suites-cost)); the target, under 200
  CPU-s on an idle machine, and a build measured again against the run that
  motivated this (full checks per run, CPU per tool command) need an idle
  machine and a real run. Carried, unplanned.
- **L270 · A path marked `assume-unchanged` or `skip-worktree` is not hashed
  again.** The key starts from a copy of the real index, so an edit to such a
  path can give a false hit.
- **L271 · The key leaves loose objects behind.** `git add -A` into the
  temporary index writes the changed files as unreachable loose objects, which
  stay until `git gc` removes them.
