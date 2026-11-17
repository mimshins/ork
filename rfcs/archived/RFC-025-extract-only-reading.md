# RFC-025 — Make `extract` the way sessions read, on every driver

- **Status:** Implemented
- **Date:** 2026-11-17
- **Supersedes:** —
- **Superseded by:** —
- **ADR:** [ADR-101](../../decisions/ADR-101-extract-only-reading.md)

## Context

[RFC-023](../archived/RFC-023-extract-tool-for-session-reads.md) added
`extract`, a tool that returns only the part of a file, search or git output a
session keeps, because every tool result is read again on each later turn
([ADR-098](../../decisions/ADR-098-extract-tool.md)). So far Ork only **steers**
sessions to it: it loads the tool up front, and one line of the harness
instructions tells every session to read, search and see git output through it.
Steering has helped, but only partly. These are shares of the carried weight of
reads (`pnpm benchmark:carried`), across three `build` runs of this repository
on 2026-11-17:

| Build    | extract | Read  | shell reads | searches | git shell |
| -------- | ------- | ----- | ----------- | -------- | --------- |
| 88e38060 | 34.2%   | 13.6% | 17.3%       | 17%      | 10.5%     |
| c6951849 | 50.5%   | 2.2%  | 15%         | 8.7%     | 0.1%      |
| 815000df | 65.3%   | 24.8% | 2.3%        | 4.1%     | 0%        |

The three runs did different tasks, so this is a trend, not a measurement. The
before/after benchmark (follow-up fdd85801) has a plan but has not run yet.

Where the rest goes:

- **A read-only session that had the tool and the line ignored both.** The
  onboard proposer of run cbf45e85 made 17 Reads, 8 Globs and no `extract` call.
  Its own built-in text told it to "Read the files" and listed
  `tools.only: [Read, Grep, Glob]`. The text is fixed (03b49049); the tools are
  still offered.
- **Reviewers search with Grep.** In 815000df, review.2 made 10 Grep calls and
  review.1 made 5. This repository's reviewer agent lists Grep in its
  frontmatter, which Ork passes as `--tools`.
- **Ork itself invites shell git reads.** `READ_ONLY_COMMANDS` in
  [plan.ts](../../packages/core/src/run/plan.ts) pre-allows `git diff`,
  `git log`, `git show` and `git status` in Bash for every `readonly` node, so
  those calls never ask, while `extract` covers the first three.
- **The project's text comes before Ork's.** In `systemAppend`, project
  practices and context come before the harness lines, so a project that says
  "grep for it" outweighs Ork's rule.
- **`extract` can't do everything the alternatives do**
  ([L414](../../specs/gaps/extract-limits.md)). One call has one producer, so
  two files take two calls. It has no way to list files, so Glob is still
  needed. `match` is a literal substring. A refused call has to be redone.

**Code Mode.** "Code Mode" has the model write one program that makes many tool
calls, and only the program's output enters the conversation. Claude Code has
one, but only in an interactive terminal, not with `-p`, which the `claude-code`
driver runs ([L433](../../specs/gaps/extract-limits.md)). OpenCode has one for
MCP servers, and Ork turns it off for its own server so that the model sees
`ork_<tool>` ([open-code.md](../../specs/runtime/open-code.md)). Command Code
has none. Ork cannot rely on any driver's Code Mode.

**What each driver can enforce today.** `claude-code` passes a node's
`tools.only` as `--tools` and its `deny` as `--disallowedTools`. `open-code`
writes the whole permission rule set each session, denying first. On
`command-code`, a mod's `beforeToolCall` hook blocks any call the node did not
allow, command by command for a shell line. `extract` is served on all three.

## Options

### Option A — Steering only (today)

More and stronger text: harness lines, tool descriptions and built-in text.

- **Pros:** no engine change; a session keeps every tool for the odd case.
- **Cons:** it has already reached its limit (the cases above); project text
  comes first; every session pays for the extra text.

### Option B — Prevention, plus a richer extract (the maintainer's pick)

Make the other ways unavailable where `extract` can do the job, and give
`extract` what is still missing, so it never needs to fall back. There are three
parts, served on all three drivers:

1. **Withhold the alternatives.** When a session is offered `extract`, Ork
   removes Grep and Glob from its tools. A node that cannot edit (`readonly`, or
   a `tools.only` without Edit and Write) also gets no Read. A node that edits
   keeps Read, because Claude Code's Edit needs a prior Read of the file.
   - `claude-code`: `--disallowedTools`.
   - `open-code`: deny rules for `read`, `grep`, `glob` and `list`.
   - `command-code`: the mod's deny.
2. **Refuse shell reads.** Ork denies `cat`, `head`, `tail`, `less`, `more`,
   `sed`, `awk`, `grep`, `egrep`, `rg`, `find`, `ls -R`, and `git diff`, `show`,
   `log` and `grep`, as whole commands and as parts of a pipeline. The refusal
   names the `extract` call to make instead. `READ_ONLY_COMMANDS` keeps only
   `git status`.
   - On `claude-code`, a `PreToolUse` hook denies the call with the reason as
     text, beside the permission rules Ork already writes.
   - `open-code`: deny rules.
   - `command-code`: the mod, which already checks command by command and
     returns its reason.
3. **A step program: Code Mode without model-written code.** `extract` takes a
   list of programs in one call. Each program is a producer followed by cuts,
   and the results are joined under one header per program, within the same
   16,000-character cap. New steps:
   - `files`: a producer, `git ls-files` with a glob pathspec, untracked files
     included. It replaces Glob.
   - `match` gains a `regex` form.
   - `around: n`: lines of context around each match.
   - `count`: a cut that returns only the number of lines.

   Ork runs the steps in its own process, as today: no model-written code, no
   shell, no sandbox. That keeps the promise the security audit and read-only
   nodes depend on.

The project decides how strict to be, as with every Ork side effect: a rule
(`rules.reading`: `extract`, the default, or `open`) in `.ork/project.yaml` or a
workflow, with a node's explicit `tools.only` or `allow` naming a withheld tool
winning for that node.

- **Pros:** it removes the choice instead of arguing for it (prevention over
  detection); it is the same on all three drivers, so a fourth one (RFC-024's
  Codex) only maps the rules; it fixes the gaps that force a fallback; it runs
  nothing the model drafted.
- **Cons:** an engine change on every driver; a session in a folder that is not
  a git repository can't search or list through `extract` (`git grep`), so
  withholding must stay off there; a project that relies on `grep -r` over
  ignored files loses it unless it sets `open`; Read of an image or PDF has no
  `extract` path (see Open questions).

### Option C — A real Code Mode: JavaScript in a sandbox

The model writes a script against a read-only API (files, search, git), and Ork
runs it in an isolated VM with no network and no writes, returning only what it
prints.

- **Pros:** the most flexible; one call can do any analysis.
- **Cons:** Ork would run model-drafted code, which the security audit, the
  onboard verbs and `extract` itself promise it never does; a VM that is
  isolated enough on macOS, Linux and Windows is a project of its own; the
  output is harder to bound and to account for.

### Option D — Each driver's own Code Mode

- **Cons:** Claude Code's doesn't work in `-p`, OpenCode's applies to MCP
  servers (Ork turns it off on purpose), and Command Code has none. Not
  available.

## Decision

Option B, chosen by the maintainer on 2026-11-17: withhold the alternatives,
refuse shell reads, and extend `extract` into a step program, on every driver,
with a project rule to loosen it. Option C was declined because it would run
model-drafted code. The built-in text was fixed first, separately (03b49049).

## Consequences

- **Specs:** `specs/runtime/extract-tool.md` (the steps, several programs per
  call, who has what withheld), the three driver specs (`claude-code`,
  `open-code`, `command-code`: how each one withholds and refuses),
  `specs/run/plan` for `READ_ONLY_COMMANDS`, the project and workflow schema for
  `rules.reading`, and `specs/gaps/extract-limits.md` (L414 mostly closes; L433
  stays).
- **Docs:** `docs/guides/skills-and-context.md` (reading) and the project-rules
  guide; a next-release bullet with an "Upgrade:" line, since a project's
  sessions lose Grep, Glob and shell reads by default.
- **Measuring:** the fdd85801 benchmark compares off against Option B, not
  today's steering, so the result shows what this RFC buys.
- **An ADR** when it ships, and this RFC moves to `rfcs/archived/`.
- **Follow-ups:** RFC-024's Codex driver maps the same rules.

## Answered questions

Answered by the maintainer on 2026-11-17, when accepting:

1. **Read of images and PDFs** in a node that can't edit: Read stays allowed for
   image and PDF paths only (Claude Code rule specifiers; OpenCode and Command
   Code patterns); text files go through `extract`.
2. **The rule:** `rules.reading: extract | open`, defaulting to `extract` in
   every project; a project or workflow sets `open` to loosen it, and a node's
   explicit `tools.only` or `allow` naming a withheld tool wins for that node.
3. **The order of work:** the step program first (`files`, several programs a
   call, `regex`, `around`, `count`), then refusing shell reads, then
   withholding, so a session is never left without a way to do something.

## Open questions

1. **A folder that isn't a git repository:** fall back to steering only (the
   proposal), or make `files` and `search` walk the folder in Ork's process?
2. **The refusal's text:** does a refused Bash call count as a failed turn in
   `ork feedback`, or as an expected redirect that isn't reported?
