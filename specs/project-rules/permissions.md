# Permissions without asking

_Part of [Project rules](../project-rules.md)._

Status: **Built** on the `claude-code` driver: the shell reader
([shell-line.ts](../../packages/core/src/run/shell-line.ts)), the shipped reads
([shell-safe.ts](../../packages/core/src/run/shell-safe.ts)), the verdict
([permission-verdict.ts](../../packages/core/src/run/permission-verdict.ts),
used by the `permission` tool,
[permission.ts](../../packages/runtime/src/tools/permission.ts)), the rules a
prompt offers ([shell-rule.ts](../../packages/core/src/run/shell-rule.ts)), the
scopes
([permission-prompt.ts](../../packages/core/src/control/permission-prompt.ts),
[queue.ts](../../packages/core/src/control/queue.ts)), the "always" write
([allow-rules.ts](../../packages/core/src/project/allow-rules.ts),
[project-edit.ts](../../packages/schema/src/project-edit.ts)) and the
suggestions
([permission-suggest.ts](../../packages/core/src/feedback/permission-suggest.ts)).
Tests: [reader](../../packages/core/test/shell-line.test.ts),
[shipped reads](../../packages/core/test/shell-safe.test.ts),
[rules](../../packages/core/test/shell-rule.test.ts),
[verdict](../../packages/core/test/permission-verdict.test.ts),
[tool](../../packages/runtime/test/permission.test.ts),
[scopes](../../packages/core/test/permission-scopes.test.ts),
[write](../../packages/core/test/allow-rules.test.ts),
[suggestions](../../packages/core/test/permission-suggest.test.ts). The Codex,
Command Code and omp guards use the reader and the shipped reads
([guards](#the-other-drivers-guards)); OpenCode's use neither. Why:
[ADR-109](../../decisions/ADR-109-permissions-without-asking.md),
[RFC-028](../../rfcs/archived/RFC-028-permissions-without-asking.md).

Claude Code asks Ork's `permission` tool about each call its own rules neither
allow nor deny. For a shell line, Ork first gives its own verdict, so a read the
node's rules or Ork's shipped set cover runs without asking, and a read-only
node refuses what its rules don't allow instead of waiting for a person.

## The shell reader

`readShellLine` splits a line into its simple commands through pipes, lists,
`( … )`, `for … in …; do …; done`, `while`, `until` and `if`. It peels the
wrappers `time`, `env`, `timeout` and `nice` and leading `NAME=value`
assignments off each command, keeping both the whole command and the inner one.
It reads only forms it takes apart completely. A command, process or arithmetic
substitution, a backtick, `eval`, a heredoc or here-string, a function, `case`,
a `{ …; }` group, a variable or glob in a program's place, an unclosed quote,
and a redirect that writes anything but `/dev/null` or a stream make the line
unreadable, which means "ask". `<` from a literal path is a path the command
reads.

The reader is one self-contained function, so the Codex, Command Code and omp
guards embed its source and check each command of a loop or subshell against the
node's rules too
([tool-rules-source.ts](../../packages/runtime/src/tools/tool-rules-source.ts)).

## The shipped reads

Every node of every project may run these without a rule (`SHIPPED_READS`):
Ork's own reads (`ork logs`, `ps`, `tree`, `usage`, `feedback list|show`,
`follow-ups list|show`; the installed `ork` binary only), and `jq`, `wc`, `cut`,
`sort`, `uniq`, `head`, `tail`, `tr`, `ls`, `echo`, `printf`, `pwd`, `basename`,
`dirname`, `date`, `cd`, `true` and `false`.

- **`pnpm ork …`, `pnpm -s ork …` and `pnpm --silent ork …` are not shipped
  reads.** `pnpm` runs whatever the project's `package.json` names `ork`, so a
  node that edits it could change what a later node runs without anyone being
  asked ([ADR-112](../../decisions/ADR-112-shipped-reads-without-pnpm.md)). Such
  a line asks, or is refused, like any command no rule covers.

- A program that can write or run something is in only without that form:
  `sort -o`, `--output`, `--compress-program` or `-T`; `uniq` with a second
  operand; `tail -f` or `-F`; `date -s` or an operand that sets the date, and
  `date -f` (it prints a file's lines in its error text), in any short cluster
  and as `--file` or `--set`, with `=` or abbreviated (`-r` stays; a false
  refusal such as macOS `date -j -f` costs one prompt, never a wrong allow);
  `printf -v`; `jq -f`, `-L`, `--from-file`, `--rawfile`, `--slurpfile`,
  `--argfile`, or a program naming `env`, `$ENV`, `input_filename`, `import` or
  `include`; `sort` and `wc` with `--files0-from`; `ork usage --clear-…`. Such a
  program with an argument the shell expands is not covered.
- A path a shipped read names is placed from the session's folder and from every
  folder a `cd` in the line may have moved to, so a `cd` later in a loop counts.
  The worst place wins; a `cd` Ork cannot follow, or `env -C` / `--chdir` (the
  reader leaves those unread), makes the line ask. A loop body is modelled as
  running twice, so the placing follows `cd` through two passes; over 64 places
  the line asks. The rules reach the live `permission` tool through
  `sessionRules(spec)`
  ([session-rules.ts](../../packages/runtime/src/session-rules.ts)).
- A wrapped command needs an allow rule that covers the inner command: a rule on
  `timeout`, `nice` or `env` alone does not cover what runs inside them.
- A command with an assignment, a program named by a path or by an expansion,
  and `sed`, `awk`, `find`, `tee`, `xargs` and interpreters are never covered.
- A shipped read of a file outside the session's folder (and `~/.ork`) is not
  covered; `ls` lists any folder.
- `isShippedRead` is one self-contained function, as `readShellLine` is, so the
  guards embed its source; `NO_FILES` (programs that read no file) and `LISTS`
  (`ls`) are exported from `@krapht/ork-core` so the verdicts cannot drift.

## The other drivers' guards

The Codex hook, Command Code's mod and omp's guard share one matcher
([tool-rules-source.ts](../../packages/runtime/src/tools/tool-rules-source.ts)).
After a deny rule, the write limit, the `reading: extract` refusal, `only` and
the yolo and read checks, and before "not allowed for this node", a `Bash` line
is allowed when every command is covered by an allow rule or is a shipped read.
A shipped read counts only when:

- the line has no `cd` and no command has an expanded word (the guards do not
  model `cd`, [L527](../gaps/permissions-limits.md)); and
- each path word, and a `<` input, resolves inside the worktree by the guard's
  own `inside` check. `NO_FILES` programs need no path check and `ls` may list
  any folder, as in the verdict above.

An allow-rule command and a shipped read mix on one line. A line the reader
cannot read is covered only by a plain `Bash` rule. A node with a `Read(...)`
deny rule has a shipped read that names any path refused, stricter than the
verdict ([L529](../gaps/permissions-limits.md)). OpenCode matches globs itself,
and no shipped read is allowed there ([L528](../gaps/permissions-limits.md)).

## The verdict

For a `Bash` call whose session gave its rules, in this order:

1. A line the reader can't read: ask, with `allow` and `deny` only.
2. A command that matches, or may match, a deny rule (with or without its
   wrappers, or any command with an expanded argument against a rule on its
   program): deny, `denied for this node`.
3. A node that refuses (below) and a line that reads files under `reading` other
   than `open`: refuse, with the `extract` call to make instead.
4. A path a command reads that a `Read(...)` deny rule names: ask.
5. Every command covered by an allow rule or the shipped reads: allow.
6. A node that refuses: refuse.
7. Otherwise ask, offering a rule for each uncovered command.

Any other tool, and a session without rules, asks as before. An allow or a
refusal opens no decision: the call and its result are already events.

## Refusing: `unlisted`

`unlisted: refuse | ask` says what happens to a shell command no rule covers. It
is a node's `tools.unlisted`, a workflow's `rules.permissions.unlisted` and a
project's `permissions.unlisted`: the node's wins, then the workflow's, then the
project's, else `refuse` on a `readonly` node and `ask` on any other. A yolo run
is never refused, and deny rules still apply in it.

A refusal is a deny with a message the session can act on: the node runs only
the commands its rules allow and the shipped reads, which command was not one of
them, the node's `Bash` rules, the shipped reads in one line, and what to call
instead. It names rules, never a command's output. A refused call is never
turned into a prompt, however often it comes back; `maxTurns` and the budget
bound a session that keeps trying.

## Scopes

A prompt for a readable line whose uncovered commands each have a rule offers
`allow`, `allow-node`, `allow-run`, `allow-always` and `deny`; each scope's
description names the exact rules. The options and how a run remembers them are
in [messaging](../messaging.md#decisions).

`ruleFor` gives a command's program and subcommand with ` *` after them, and no
further: `ork logs r1 --json` gives `Bash(ork logs *)` and `git -C x log` gives
`Bash(git log *)`. A runner's script keeps its own subcommand (`pnpm ork logs`
gives `Bash(pnpm ork logs *)`): a person asked about it is still offered that
rule, but it is not a shipped read. Interpreters and shells, programs that run
another (`xargs`, `find`, `sed`, `awk`, `env`, `timeout`, `sudo`, `npx`, …), a
runner's subcommand that runs a package it is handed (`pnpm exec`, `pnpm dlx`,
`npm x`, `uv run`, …), a program named by a path, a command with an assignment,
and an expanded program or subcommand get no rule. A line with one such
uncovered command offers only `allow` and `deny`.

### On the terminal

The run's terminal shows a prompt with scopes as a list
([human-permit.ts](../../packages/cli/src/human-permit.ts),
[the select prompt](../cli/terminal.md#prompts)) instead of the yes-or-no
`Allow?`: Allow, Allow for this node, Allow for this run, Always allow (when
offered) and Deny, each scope's rules in its description, as `ork decide` and
the UI show them. Deny takes the optional note line and Ctrl-C stops the run, as
with the yes-or-no
([the terminal](../cli/running-and-runs.md#questions-and-permissions-on-the-terminal)).

## "Always"

`allow-always` appends the rules to `permissions.allow` of the project's rules
file, `.ork/project.yaml` in the user's checkout (never a node's worktree), or
`~/.ork/projects/<id>/project.yaml` for an attached project
([projects](../projects.md)). It is offered only when the run knows that file.

- The file is created with `schemaVersion: 1` when missing; a rule already there
  is skipped; only the lines that change differ, so comments and layout stay.
- A file that doesn't parse, or would no longer be valid project rules, is not
  written. The run's terminal says so, and the rules still hold for the run; the
  node never fails for it.
- The rules also hold for the rest of the run, as for `allow-run`.

## Suggestions

A rule people keep allowing one call, node or run at a time (3 allows across at
least 2 runs) that the project's allow rules don't cover becomes one feedback
item, `permission.suggest`, naming the rule and the file to add it to. Ork
writes nothing; the person adds it ([capture](../feedback/capture.md)).

Limits: [permissions](../gaps/permissions-limits.md), and
[L234](../gaps.md#limits) for the other drivers.
