# Who gets `extract`, and what it takes

_Part of [The `extract` tool](./extract-tool.md)._

## Who gets it

Every session whose spec has a folder: the session runner sets `cwd` (the spec's
`cwd`) and `denyRead` (the `Read(...)` patterns of `tools.deny`) on the tool
context, and the tool is offered only when `cwd` is set. It is preapproved, one
line in `ORK_TOOLS`, and the five drivers serve it as they serve every Ork tool
(`mcp__ork__extract`, OpenCode's `ork_extract`, `omp`'s
`mcp__ork_session_ork_extract`). Every session's harness instructions carry the
whole rule in one line: read, search and see git output through it, several
calls in one turn rather than one chained shell command, and a whole-file Read
only to edit. It ships with Ork, so a project's own context need not repeat it.

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

**Arguments as clients send them.** `steps: null` or `programs: null` is taken
as absent, and a JSON string of the right shape (`"[{\"step\":\"read\",…}]"`) as
what it holds, since some clients send either for an array. A string that does
not parse says `steps must be an array of steps, not a string` (`programs`:
`… of programs`). The advertised JSON Schema of both fields stays an array
(`z.preprocess` does not change it), and the tool's description names what
`search` takes beyond a pattern: one path or several separated by spaces, a
`glob` to filter files, `context` lines around hits, and `regex: false` for
fixed text (`extract-schema.ts`, tests:
[extract](../../packages/runtime/test/extract.test.ts)).

**A refusal says what to send instead.** Each message names the cause and the
shape that would have worked:

- An empty `search` `pattern`:
  `empty: give a pattern, or read the file to keep every line`. An empty `match`
  `text`: `empty: drop the match step to keep every line`.
- A step out of order names itself and its position (`step 1 is count, a cut`),
  says a program starts with read, files, search or git and its cuts (head,
  tail, match, count) follow that producer in the same program, and that each
  item of `programs` is a separate program. A producer after step 1 says only
  step 1 is a producer, and to give `programs` for several.
- An item of `programs` that is not an array:
  `each program is an array of steps; wrap a single step as [[{...}]]`.
- An unknown field lists that step's own:
  `search takes: step, pattern, path, glob, context, regex, ignoreCase, maxMatches, max`.
- A `search` path that does not exist: `no such file or folder: <path>`, the
  call's mistake (`BAD_ARGUMENTS`), never an Ork failure. With several paths in
  `path`, the message names the missing part.
- A path outside the folder: see
  [where it may read](./extract-reading-rules.md#where-it-may-read).

| Step     | Fields                                                                                                                                                        | Yields                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`   | `path`, `from?`, `to?` (lines, 1-based, inclusive)                                                                                                            | the lines as `12: text`, so an edit can anchor on them; a binary file (a NUL in the first 8 KiB) is refused                                                                                                                                                                                                  |
| `files`  | `path?` (a folder, default `.`), `glob?`, `max?` (200, at most 1,000)                                                                                         | `git ls-files --cached --others --exclude-standard` (tracked and untracked, not ignored, not denied), sorted, each path matched against `glob` by `path.posix.matchesGlob` (`**` crosses folders; a glob without `/` is matched against the name at any depth); `[N more files: …]` past `max`; `[no files]` |
| `search` | `pattern` (POSIX ERE), `path?` (default `.`; several paths separated by whitespace), `glob?`, `context?`, `regex?`, `ignoreCase?`, `maxMatches?` (50), `max?` | `git grep -E -n -I --untracked` hits as `file:line: text`, then `[N more matches: …]` past the cap; `[no matches]`; see [search](#search)                                                                                                                                                                    |
| `git`    | `op`: `diff` (`base?`, `staged?`, `path?`), `show` (`ref?`, default `HEAD`, `path?`), `log` (`ref?`, `n?` 20, at most 50, `path?`)                            | the diff, the commit, or `log --oneline`, which never prints a patch                                                                                                                                                                                                                                         |
| `head`   | `lines`                                                                                                                                                       | the first lines                                                                                                                                                                                                                                                                                              |
| `tail`   | `lines`                                                                                                                                                       | the last lines                                                                                                                                                                                                                                                                                               |
| `match`  | `text` (a literal substring, or with `regex: true` a POSIX ERE), `ignoreCase?`, `context?`                                                                    | the lines holding it, with `context` lines around, `--` between runs                                                                                                                                                                                                                                         |
| `count`  | `path?` (accepted, ignored)                                                                                                                                   | `N lines`: how many lines the text before it has                                                                                                                                                                                                                                                             |

### Search

What `search` accepts beyond a pattern, so a call a model sends the usual way
works instead of costing a refused round trip
([extract-search.ts](../../packages/runtime/src/tools/extract-search.ts)):

- **`path`** is one path, or several separated by whitespace. The whole string
  is tried first: if it exists (even with a space in it) it is the one path.
  Otherwise each part is checked on its own: every part goes through the same
  containment and deny check as a single path, and a missing part is refused
  (`no such file or folder: <part>`). All parts follow `--` in the git call, so
  they stay literal pathspecs.
- **`glob`** keeps the hits in files it matches, by the rule `files` uses
  ([extract-glob.ts](../../packages/runtime/src/tools/extract-glob.ts)): without
  a `/` it matches the file's name at any depth (`*.ts`), with one it matches
  the whole path (`src/**/*.ts`). It is applied to the file names git returned,
  in Ork's process, before the `maxMatches` cut.
- **`context`** is `git grep -C <n>`. Hits and context lines are both printed as
  `file:line: text`: with `--null` git writes `\0` after the file name and the
  line number on context lines as well as hits, so both parse alike, and git's
  own `--` separators (fewer than 3 parts) are dropped. Ork rebuilds the `--`
  between runs that are not adjacent, and between different files, from file and
  line numbers, after the deny and glob filters, so a denied file's lines never
  appear and none leaves a stray `--`. With `context` above 0 the cap counts
  lines, and the footer says `[N more lines: …]`.
- **`regex`**: `true` is the same as leaving it out; `false` searches the
  pattern as fixed text (`git grep -F`), so `(` is not a regex error.
- **`max`** is another name for `maxMatches`; `maxMatches` wins when both are
  given. A value over 200 is clamped to 200, not refused.
- A git exit 1 whose stderr holds only `warning:` lines is a result,
  `[no matches]`, not a failure.
