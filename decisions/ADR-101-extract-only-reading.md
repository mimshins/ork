# ADR-101 — Sessions read through `extract`, on every driver

- **Status:** Accepted
- **Date:** 2026-11-17
- **Topic:** runtime, tool rules
- **RFC:** [RFC-025](../rfcs/archived/RFC-025-extract-only-reading.md)

## Context

[ADR-098](./ADR-098-extract-tool.md) added `extract` and only steered sessions
toward it. Steering stopped short. On 2026-11-17, a read-only onboard proposer
(run cbf45e85) made 17 Reads, 8 Globs and no `extract` call, though it had both
the tool and the harness's rule. Reviewers searched with Grep. Ork itself
pre-allowed `git diff`, `log` and `show` in Bash for readonly nodes. Claude
Code's own Code Mode doesn't work in `-p`, and the other drivers have none Ork
can use.

## Decision

Option B of RFC-025: prevention, plus a richer `extract`, on `claude-code`,
`open-code` and `command-code` alike.

1. **A step program.** One `extract` call runs up to 8 programs. New steps:
   - `files`: lists files by glob;
   - `match` takes a POSIX ERE with `regex: true`, run by git, not by Ork's own
     regular-expression engine;
   - `count`: counts lines.

   No code the model wrote runs.

2. **Shell reads refused.** A pipeline that starts by reading files is refused,
   and the refusal names the `extract` call to make. A reader that filters
   another command's output still runs. A readonly node runs only `git status`
   without asking.
3. **Tools withheld.** `Grep` and `Glob` are denied unless the node names them.
   A node that cannot edit refuses `Read` of text files, but still reads images
   and PDFs.

The rule is `rules.reading` (`extract`, the default, or `open`) in
`project.yaml` or a workflow's `rules:`. The detail is in
[the `extract` spec](../specs/runtime/extract-tool.md#shell-reads),
[tool-rules.ts](../packages/core/src/run/tool-rules.ts) and
[shell-reads.ts](../packages/runtime/src/tools/shell-reads.ts).

## Options considered

- **A: Steering only.** It had already reached its limit.
- **B: Prevention, plus a richer `extract`.** Chosen.
- **C: JavaScript in a sandbox (a real Code Mode).** Declined: Ork would run
  code the model wrote.
- **D: Each driver's own Code Mode.** Not available.

## Rationale

Making the alternatives unavailable works where arguing for `extract` did not.
The step program closes the gaps that forced a fallback. One rule, mapped onto
each driver's own mechanism, keeps the drivers alike:

- Claude Code's `PreToolUse` hook;
- Command Code's mod;
- OpenCode's permission rules.

## Consequences

- **Upgrade:** a project's sessions lose Grep, Glob and shell reads by default.
  `reading: open` turns this off.
- **Uneven across drivers ([L436](../specs/gaps/extract-limits.md)):** OpenCode
  matches the whole line from its start and shows its own refusal message, and
  every driver checks by program name.
- **Not covered:** a folder that isn't a git repository can't be searched or
  listed through `extract`. Whether a refused read counts in `ork feedback` is
  still open.
- **Measuring:** the before/after benchmark (follow-up fdd85801) measures what
  this buys.
