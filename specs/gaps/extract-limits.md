# Limits found building `extract`

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found planning and building [the `extract` tool](../runtime/extract-tool.md) and
the carried-weight script
([RFC-023](../../rfcs/archived/RFC-023-extract-tool-for-session-reads.md)). What
was left simpler, or could not be checked:

- **L414 · The step language is small.** One producer a call, so two files are
  two calls. A path is literal (`GIT_LITERAL_PATHSPECS`): no glob in `search` or
  `git`. `search` runs `git grep --untracked`, so an ignored file
  (`node_modules`, build output) is never searched, and a folder that is not a
  git repository can be read but not searched. `match` is a literal substring,
  not a pattern. `git diff` compares a `base` (or range) with the working tree
  or the index; two refs need a range. `read` always numbers its lines.
- **L422 · Git-reported names are matched case-sensitively.** Paths taken from
  git output (search hits, diff headers) are checked against the deny list as
  written, so a committed file with odd case (`.ENV` on a case-insensitive disk
  with `core.ignorecase`) is not denied by a rule for `.env`.
- **L415 · The deny list reads only the project's Claude Code settings.** It
  joins the built-in names, the session's `Read(...)` rules and the `Read(...)`
  entries of the project's `.claude/settings.json` and `settings.local.json`.
  User-level (`~/.claude`) and managed settings are not read, nor are
  `Bash(...)` deny rules (a session denied `cat` may still `read`), nor the
  other drivers' own permission settings (OpenCode's, Command Code's). Rules are
  matched with `path.matchesGlob`, which can differ from gitignore on edge cases
  (negation `!`, escapes); a `/` inside a brace group (`{a/b,c}`) splits the
  pattern wrongly. The settings files are read from the session's folder, not
  the project's root: a node working in a subfolder misses the root's rules.
- **L416 · A file over 8 MiB is refused by `read`.** The step loads the whole
  file before it cuts the range; a large log or lockfile needs `search`.
- **L417 · An ambiguous diff header is refused whole.** A `diff --git a/X b/Y`
  header whose names hold ` b/` can be split more than one way; the section is
  replaced by `[refused: …]` if any split names a denied file, so an allowed
  file with such a name may be refused.
- **L418 · An error result has no footer.** A refused or failed call returns one
  short line, so the carried-weight script counts that line's characters as
  returned and the call among `extract`'s calls: it cannot tell a failed call
  from one that worked, and reports no count of failures.
- **L419 · The carried-weight kinds are a heuristic.** A Bash call is sorted by
  its first real command (leading `cd`, `export` and assignments skipped; a
  pipeline by its first command), so a compound command may be mislabeled. It
  moves weight between kinds, never the total.
- **L420 · The carried-weight script reads only the node's own Claude Code
  sessions.** Subagent transcripts, forks (a leader's question fork) and
  sessions on `open-code` or `command-code` are not counted; a session whose
  transcript is gone (another machine, pruned) is counted under
  `missing_transcripts` by role.
- **L421 · A hostile checkout's git config still runs.** `extract` turns off
  textconv, external diff and fsmonitor, but other settings in the checkout's
  `.git/config` that name a program are the same risk as Ork's other git calls
  there.
- **C18 · `benchmarks/method.md` is over 200 lines.** It is 207 with the
  carried-weight section, and `benchmarks/` is outside `pnpm docs:check`'s
  hub-and-chunk rule. Splitting it would move anchors that specs and benchmark
  pages link to (`#the-manual-baseline`, `#the-suites-cost`,
  `#a-build-measured-again`), so it waits for the next review.
