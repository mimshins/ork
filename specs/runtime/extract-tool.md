# The `extract` tool

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built**: the tool, its steps and programs, containment and refusals,
the refusal of shell reads, and the withheld tools (RFC-025), served on
`claude-code`, `open-code` and `command-code`
([extract.ts](../../packages/runtime/src/tools/extract.ts),
[extract-steps.ts](../../packages/runtime/src/tools/extract-steps.ts),
[extract-git.ts](../../packages/runtime/src/tools/extract-git.ts),
[contain.ts](../../packages/runtime/src/tools/contain.ts); tests:
[extract](../../packages/runtime/test/extract.test.ts),
[steps](../../packages/runtime/test/extract-steps.test.ts),
[containment](../../packages/runtime/test/contain.test.ts),
[contract](../../packages/runtime/test/contract/contract.test.ts)). Why:
[RFC-023](../../rfcs/archived/RFC-023-extract-tool-for-session-reads.md), option
2a, and [ADR-098](../../decisions/ADR-098-extract-tool.md). Its effect on cost
is not measured yet (the before/after benchmark is a follow-up;
[carried weight](../../benchmarks/method.md#carried-weight)).

A tool result stays in the conversation, and every later turn reads it again
from the cache. `extract` reads part of a file, searches, or shows a diff, and
returns only the extract, so a whole file or a long diff never enters the
conversation. It runs a short list of read-only steps in Ork's process: no
model-written code, no shell, no sandbox.

## Who gets it

Every session whose spec has a folder: the session runner sets `cwd` (the spec's
`cwd`) and `denyRead` (the `Read(...)` patterns of `tools.deny`) on the tool
context, and the tool is offered only when `cwd` is set. It is preapproved, one
line in `ORK_TOOLS`, and the three drivers serve it as they serve every Ork tool
(`mcp__ork__extract`, OpenCode's `ork_extract`). Every session's harness
instructions carry the whole rule in one line: read, search and see git output
through it, several calls in one turn rather than one chained shell command, and
a whole-file Read only to edit. It ships with Ork, so a project's own context
need not repeat it.

**Loaded up front.** Claude Code defers MCP tools behind a tool search, and a
session that has not searched for `extract` reads with Read and the shell
instead: on 2026-11-17, 7 of the first 8 sessions on 1.0.0-alpha.23 made no
`extract` call, and the one that loaded it made 36. So `tools/list` marks
`extract` with `_meta: { "anthropic/alwaysLoad": true }` (`alwaysLoad` on the
bound tool; Claude Code v2.1.285 or later), which puts it in the session's tools
from the first turn. The other drivers ignore `_meta`; Ork's other tools stay
deferred.

**Pause.** A paused run or node holds an `extract` call as it holds any tool
call: the driver's hook (Claude Code's `PreToolUse`, matcher `*`; Command Code's
mod; OpenCode's rules) does it, and the tool has no code for it
([run control](../run-control.md#pause)).

## Steps

`extract({ steps, from? })` or `extract({ programs, from? })`
([RFC-025](../../rfcs/archived/RFC-025-extract-only-reading.md)). A program,
`steps`, is 1 to 6 objects, each named by its `step` field. The first is a
**producer**; the rest are **cuts**, each taking the text before it. Anything
else (a cut first, two producers, an unknown step or field, a value out of
range) is a Zod error with Ork's readable issues. `programs` is 1 to 8 programs
run in one call (at once), so several files or searches cost one turn: Code Mode
without model-written code. A call gives exactly one of the two.

| Step     | Fields                                                                                                                             | Yields                                                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`   | `path`, `from?`, `to?` (lines, 1-based, inclusive)                                                                                 | the lines as `12: text`, so an edit can anchor on them; a binary file (a NUL in the first 8 KiB) is refused                                                                                                                                           |
| `files`  | `path?` (a folder, default `.`), `glob?`, `max?` (200, at most 1,000)                                                              | `git ls-files --cached --others --exclude-standard` (tracked and untracked, not ignored, not denied), sorted, each path matched whole against `glob` by `path.posix.matchesGlob` (`**` crosses folders); `[N more files: …]` past `max`; `[no files]` |
| `search` | `pattern` (POSIX ERE), `path?` (default `.`), `ignoreCase?`, `maxMatches?` (50, at most 200)                                       | `git grep -E -n -I --untracked` hits as `file:line: text`, then `[N more matches: …]` past the cap; `[no matches]`                                                                                                                                    |
| `git`    | `op`: `diff` (`base?`, `staged?`, `path?`), `show` (`ref?`, default `HEAD`, `path?`), `log` (`ref?`, `n?` 20, at most 50, `path?`) | the diff, the commit, or `log --oneline`, which never prints a patch                                                                                                                                                                                  |
| `head`   | `lines`                                                                                                                            | the first lines                                                                                                                                                                                                                                       |
| `tail`   | `lines`                                                                                                                            | the last lines                                                                                                                                                                                                                                        |
| `match`  | `text` (a literal substring, or with `regex: true` a POSIX ERE), `ignoreCase?`, `context?`                                         | the lines holding it, with `context` lines around, `--` between runs                                                                                                                                                                                  |
| `count`  | none                                                                                                                               | `N lines`: how many lines the text before it has                                                                                                                                                                                                      |

## Shell reads

Under `reading: extract`, the default
([project rules](../project-rules.md#links-and-reading),
[RFC-025](../../rfcs/archived/RFC-025-extract-only-reading.md)), a shell line in
which a pipeline **starts** by reading files is refused, and the refusal names
the `extract` call to make: `cat`, `head`, `tail`, `less`, `more`, `nl`, `sed`
(not `sed -i`), `awk`, `grep`, `egrep`, `fgrep`, `rg`, `ag`, `find` (not with
`-exec`, `-ok` or `-delete`), `tree`, `ls -R`, and `git diff`, `show`, `log` and
`grep` (after any `-C`, `-c` or other option). A reader later in a pipeline
filters another command's output, which `extract` can't read, so
`pnpm test | tail -20` runs. One function decides
([shell-reads.ts](../../packages/runtime/src/tools/shell-reads.ts)):

- **`claude-code`**: Ork's `PreToolUse` HTTP hook, now on every session that
  refuses (not only on a node that can be paused), answers `deny` with the
  reason before the pause and heavy-slot checks.
- **`command-code`**: the session's mod embeds the function's source and blocks
  the call with the reason as `additionalContext`, after the node's denies.
- **`open-code`**: deny rules after the node's allows, `<command>` and
  `<command> *` for each reader (`SHELL_READ_COMMANDS`); OpenCode matches the
  whole line from its start, so only a line's first pipeline is refused there,
  and its message is OpenCode's own ([L436](../gaps/extract-limits.md)).

A `readonly` node then runs only `git status` without asking; `git diff`, `log`
and `show` come back under `reading: open`.

## Withheld tools

Under `reading: extract`, Ork adds `Grep` and `Glob` to every session's denied
tools ([tool-rules.ts](../../packages/core/src/run/tool-rules.ts),
`WITHHELD_TOOLS`), unless the node names one in its own `tools.allow` or
`tools.only`: `extract`'s `search` and `files` do their work. A node that cannot
edit (`readonly`, or a `tools.only` with no `Edit` or `Write`) is
`extract-only`: a `Read` of a text file is refused too, with the `extract` call
to make, while an image or a PDF (which `extract` cannot read) is still read. A
node that edits keeps `Read`, which Claude Code's `Edit` needs first. On
`claude-code` the hook refuses the Read, on `command-code` the mod does, and on
`open-code` a `read` deny with the image and PDF types allowed after it.

## Where it may read

- **Containment.** A path, relative to the folder or absolute, is resolved with
  its symlinks followed (a path that does not exist yet, by its nearest existing
  folder). It must stay inside the folder's real path and out of Ork's private
  session folder (`secretRoot()`, the bearer-token configs). A path that starts
  with `:` (git's pathspec magic) is refused. The refusal names the path only:
  `refused: <path> (outside the folder)`.
- **The deny list.** A file is refused by `read`, `search` and `git` when the
  path as asked, or as resolved (a symlink to a denied file), matches:
  - the built-in names, at any depth: `.env*`, `*.pem`, `*.key`, `id_rsa*`,
    `.npmrc`, and anything under a `.git` folder (reached only through the git
    steps);
  - a `Read(...)` rule of the session's `tools.deny` (a bare `Read` denies every
    file);
  - a `Read(...)` entry of `permissions.deny` in the project's
    `.claude/settings.json` or `.claude/settings.local.json`, read each call.
- **Rule paths** are read gitignore-style: `//x` is absolute, `~/x` under the
  home folder, `/x` and `./x` from the folder, a name with no `/` matches at any
  depth, and a rule on a folder covers its files. Matching uses Node's
  `path.matchesGlob`, with dot names matched as gitignore does. A `//` or `~/`
  rule is matched against the file's absolute path, as given and as resolved,
  and against each folder above it, so a rule above the session folder still
  applies. A rule that can't be made into a matcher (an empty `Read()`) denies
  every file.
- **Case and symlinks.** The resolved path is the on-disk one
  (`realpathSync.native`), so on macOS a `Read` rule on `.env` also matches
  `.ENV`. Names that git prints (diff headers, search hits) are not resolved on
  disk, so they match case-sensitively. The project settings are read from the
  session's folder, not the repository root.
- **Fail closed.** A settings file that exists but can't be parsed, or whose
  `permissions.deny` is not a list of strings, refuses every path and says which
  file to fix.
- **In a diff,** each section (`diff --git`, `--cc`, `--combined`) whose file is
  denied is replaced by `[refused: <path>]`. A header that could name more than
  one path (a name holding ` b/`) is refused if any reading of it is. Search
  hits in denied files are dropped.

## No shell

Git runs through `execFile`, never a shell, with fixed arguments: `--no-pager`,
`--no-color` (so no `color.*` setting puts escape codes in a header or a hit),
`-c core.quotePath=false`, `-c core.fsmonitor=false`; diff and show add
`--no-ext-diff`, `--no-textconv`, `--relative` and
`--src-prefix=a/ --dst-prefix=b/`, so no repository setting changes the headers.
Its environment adds `GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1` (no glob
or `:` magic in a path) and `GIT_OPTIONAL_LOCKS=0` (a diff does not take the
index lock from the session's own git calls). A call has a 10 s timeout and a 1
MiB output cap; past the cap the output ends with `[git output cut at 1 MiB]`.

No value from a call goes in a flag position:

- **A revision** must match `^[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*$` (no leading
  dash, no colon, so no `rev:path`). Each side of an `a..b` or `a...b` range is
  then resolved with `git rev-parse --verify --quiet <rev>^{commit}` and passed
  as a commit id: a blob or tree id would print a file past the deny list.
- **A pattern** follows `-e`; **a path** follows `--`, contained and checked as
  above.

`git grep -E` keeps a model-written pattern out of Ork's own regular
expressions, so it cannot backtrack in Ork's process. The cut `match` is a
literal substring, unless `regex: true`: then the text before it is written to a
file in a new temporary folder and matched by
`git grep --no-index -h -a -E [-i] [-C n] -e <pattern> -- text` there, with the
same timeout, and the folder is removed. A glob of `files` is matched in Ork's
process by Node's `path.posix.matchesGlob`, which does not backtrack.

**A hostile checkout.** The repository's own `.git/config` can name programs git
runs. The tool turns off textconv, external diff and fsmonitor; other settings
are the same risk as Ork's other git calls in that checkout. A user's
`log.showSignature` can still run gpg on `git log`.

## The result

The last step's output, from character `from` (default 0), at most 16,000
characters. With `programs`, the output is each program's under a header
(`### 2. search <pattern> in <path>`), `[nothing]` for an empty one and
`[error: …]` for a failed one, joined and paged as one text; the footer's N is
the sum of the producers' output. The call is an error only when every program
failed. When it is cut, a line says where, and tells the session to add a
`head`, `tail` or `match` step or call again with `from`: the steps rerun and
nothing is stored. `from` counts UTF-16 units, so a page boundary can split a
surrogate pair. A page after the first that reaches the end says so.

Every result that is not an error ends with the footer
`[extract: read N characters, returned M]`: N is the producer's output, M the
characters of this page. It costs about 60 characters a call; the carried-weight
script reads it from the transcript, so there is no event for it. A `read` of a
file over 8 MiB is refused (the step loads the whole file).

An error (outside the folder, refused, not a file, not a git repository, not a
commit, git failed, timed out) is one short line with `isError`, and no footer;
git's stderr is cut to its first line.

## Limits

[L414 to L421](../gaps/extract-limits.md).
