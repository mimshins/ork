# How `extract` runs git, and what it returns

_Part of [The `extract` tool](./extract-tool.md)._

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
  in [where it may read](./extract-reading-rules.md#where-it-may-read).

`git grep -E` keeps a model-written pattern out of Ork's own regular
expressions, so it cannot backtrack in Ork's process. The cut `match` is a
literal substring, unless `regex: true`: then the text before it is written to a
file in a new temporary folder and matched by
`git grep --no-index -h -a -E [-i] [-C n] -e <pattern> -- text` there, with the
same timeout, and the folder is removed. A glob of `files` or `search` is
matched in Ork's process by Node's `path.posix.matchesGlob`, which does not
backtrack.

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
failed, and then the answer leads with the deciding error (the first program
that failed for a reason of Ork's own, else the first), then the headed results.
When it is cut, a line says where, and tells the session to add a `head`, `tail`
or `match` step or call again with `from`: the steps rerun and nothing is
stored. `from` counts UTF-16 units, so a page boundary can split a surrogate
pair. A page after the first that reaches the end says so.

Every result that is not an error ends with the footer
`[extract: read N characters, returned M]`: N is the producer's output, M the
characters of this page. It costs about 60 characters a call; the carried-weight
script reads it from the transcript, so there is no event for it. A `read` of a
file over 8 MiB is refused (the step loads the whole file).

An error (outside the folder, refused, not a file, not a git repository, not a
commit, git failed, timed out) is one short line with `isError`, and no footer;
git's stderr is cut to its first line. An error the call's own arguments caused
starts with `Invalid arguments, nothing ran:` on its own line, so the driver's
decoder files it as the agent's context gap (`tool.arguments`), not as a bug in
Ork. That covers a refusal (outside the folder, denied, a binary file, a file
over 8 MiB, a revision that is not plain), a missing file or one that is not a
file, a `search` path that does not exist, a name that is not a commit, and both
or neither of `steps` and `programs`; with `programs`, only when every program
failed that way. A pattern git cannot compile (`search`, or `match` with
`regex: true`) is the call's too: `git grep` exits 128 with
`fatal: -e option, '<pattern>': <why>` or `fatal: command line, …`, which
becomes `invalid regular expression: <pattern> (<why>)` with that line, not
`git failed` ([L486](../gaps/tool-message-limits.md)). A missing repository, any
other git failure, a timeout and a refusal of every path (the project's settings
can't be read) keep no such line: they start with the marker `Ork tool failed:`
instead, so the decoder keeps their message too. A `rev:path` revision is
refused with a line saying that `extract` cannot read a file as it was at a
commit ([L450](../gaps/extract-limits.md)).

**The message feedback keeps.** Both markers (`Invalid arguments, nothing ran:`
and `Ork tool failed:`) are followed by the message on the next line. A driver's
decoder copies that first line, at most 300 characters, into the `tool.result`'s
`message`, and only for a result that carries a marker, so a refusal or failure
of `extract` is filed with what was wrong ([capture](../feedback/capture.md),
[ADR-106](../../decisions/ADR-106-tool-result-carries-the-ork-message.md)).

## Limits

[L414 to L421, and L450](../gaps/extract-limits.md).
