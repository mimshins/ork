# ADR-098 — `extract`: a read-only step tool for what sessions read

- **Status:** Accepted
- **Date:** 2026-11-17
- **Topic:** runtime port, Ork's tools, benchmarks
- **RFC:** [RFC-023](../rfcs/archived/RFC-023-extract-tool-for-session-reads.md)
  (option 2, variant 2a)

## Context

Cache reads of a session's growing transcript are 97% of the input tokens in the
published benchmarks, and a measurement of 88 sessions put 87% of the carried
weight (a result's characters times the turns that reread it) in whole-file
reads, searches and diffs. Claude Code's Code Mode is not available to a `-p`
session, the other drivers have nothing like it, and Ork has no sandbox to run
code a model wrote. The RFC weighed the options and the maintainer chose the
first version that needs no code from the model.

## Decision

One Ork MCP tool, `extract`, in `ORK_TOOLS` beside `read_input`
([ADR-078](./ADR-078-read-input.md)), offered to every session that has a folder
(the `cwd` and the `Read(...)` deny patterns now reach `ToolContext`). A call is
one to six steps run in-process: a producer (`read` a line range, `search`,
`git` `diff`, `show` or `log`), then cuts (`head`, `tail`, `match`). The model
writes no code and the set is not extended by a call. The details are in
[the spec](../specs/runtime/extract-tool.md).

- **No shell.** `git` runs with `execFile`, fixed arguments, textconv and
  external diff off, a 10 s timeout and a 1 MiB cap; no call value goes in a
  flag position.
- **Containment.** A path resolved with symlinks followed must stay inside the
  session's folder and out of Ork's private session folder.
- **Refusal.** A built-in deny list (`.env*`, keys, `.npmrc`, `.git/` except
  through the git steps), a `Read(...)` rule in the session's `tools.deny`, and
  a `Read(...)` entry of the project's `.claude/settings.json` or
  `settings.local.json` `permissions.deny` refuse a file; a settings file that
  cannot be parsed refuses every path (fail closed). A denied file's section of
  a diff is replaced.
- **Patterns.** `search` uses `git grep -E`, so a model-written pattern cannot
  make Ork's process backtrack without end; the `match` cut is a literal
  substring. No look-around.
- **Size and counting.** The result is capped at 16,000 characters and pages
  with `from` by rerunning the steps; every result ends with
  `[extract: read N characters, returned M]`, which the benchmark reads from the
  transcript (no new event).
- **Steering.** One line in the harness instructions of every node, and a
  stronger rule in this repository's `.ork/context/build.md` for implement and
  review nodes. No permission rule blocks `cat`, until the benchmark says
  otherwise.
- **The measurement** is a script in `tools/benchmark/`
  (`pnpm benchmark:carried`, also run by `pnpm benchmark` into `carried.json`,
  which `benchmark:publish` copies). It is a proxy, not a cost
  ([method](../benchmarks/method.md#carried-weight)).

## Options considered

- **Claude Code's Code Mode (option 1).** Not available to `-p` or the other
  drivers; kept as a follow-up to revisit.
- **A program runner (variant 2b).** Needs a sandbox Ork does not have; deferred
  until the step language proves too small.
- **Detect repeated shell commands and suggest a `tool.shell` step (option 4)**
  and **shorter sessions (option 5).** Complements, kept as follow-ups.
- **A permission rule that blocks `cat`.** Would force the tool before anyone
  knows it helps; deferred to the benchmark.

## Consequences

- The tool, its limits and the heuristic carried-weight kinds are recorded in
  gaps L414 to L421 ([limits](../specs/gaps/extract-limits.md)).
- A call costs a turn and about 60 characters of footer; the saving depends on
  the model using it over `cat`. The before/after benchmark, with `carried.json`
  on the same tasks with and without the tool, is the follow-up that decides
  whether it stays; if turns rise and cost does not fall, it is one registry
  line to drop.
- A hostile checkout's `.git/config` can still name programs git runs; this is
  the risk Ork's other git calls carry, noted in the spec.
- No workflow-format, schema or event change, and no new dependency.
