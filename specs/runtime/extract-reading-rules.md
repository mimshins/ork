# What `extract` keeps a session to

_Part of [The `extract` tool](./extract-tool.md)._

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
  `<command> *` for each reader (`SHELL_READ_COMMANDS`) but `head`, `tail`,
  `sed`, `awk`, `grep`, `egrep` and `fgrep`. OpenCode 2.3 matches every command
  of a line, so `echo a && cat x` is refused, but a deny on one of those seven
  would also refuse it filtering another command's output (`pnpm test | tail`);
  they are left to the steering line there, and the message is OpenCode's own
  ([L436](../gaps/extract-limits.md)).
- **`codex`**: the session's `PreToolUse` hook refuses the shell read, and a
  text read when the node is `extract-only`, with the reason, from the matcher
  it shares with the `command-code` mod; Codex has no read tool to gate
  ([the page](./codex.md#the-hook)).
- **`omp`**: the session's guard refuses the `bash` read, and a `read` of a text
  file when the node is `extract-only`, with the reason, from the same shared
  matcher; `grep` and `glob` are not in `--tools` unless the node names them,
  and a path-scoped `Read`, `Grep` or `Glob` deny leaves out all three read
  tools ([the page](./omp-rules.md#what-holds-a-node-to-its-rules)).

A `readonly` node then runs only `git status` without asking; `git diff`, `log`
and `show` come back under `reading: open`.

## Withheld tools

Under `reading: extract`, Ork adds `Grep` and `Glob` to every session's denied
tools ([tool-rules.ts](../../packages/core/src/run/tool-rules.ts),
`WITHHELD_TOOLS`), unless the node names one in its own `tools.allow` or
`tools.only`: `extract`'s `search` and `files` do their work. Every reading rule
also withholds `AskUserQuestion` (`ASKING_TOOLS`). A node that cannot edit
(`readonly`, or a `tools.only` with no `Edit` or `Write`) is `extract-only`: a
`Read` of a text file is refused too, naming the `extract` call to make; an
image or a PDF (`extract` cannot read it) is still read. A node that edits keeps
`Read`, which Claude Code's `Edit` needs first. The hook refuses it on
`claude-code`, the mod on `command-code`, the guard on `omp`, a `read` deny
(image and PDF types allowed after it) on `open-code`.

## Where it may read

- **Containment.** A path, relative to the folder or absolute, is resolved with
  its symlinks followed (a path that does not exist yet, by its nearest existing
  folder). It must stay inside the folder's real path and out of Ork's private
  session folder (`secretRoot()`, the bearer-token configs). A path that starts
  with `:` (git's pathspec magic) is refused. The refusal names the path, never
  the folder, and says what to do:
  `refused: <path> (outside the folder): extract reads only inside your folder; give a path relative to it`.
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
