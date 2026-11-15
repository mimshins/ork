# ADR-093 — One table of short flags for every command

- **Status:** Accepted
- **Date:** 2026-11-15
- **Topic:** CLI
- **RFC:** waived — the maintainer decided this directly on 2026-11-15

## Context

Short forms were declared one flag at a time, so they drifted: `ork logs -f`
followed, `ork decide -f` was refused as an unknown flag; `-y` worked on
`ork usage` and nowhere else that takes `--yes`. `ork decide --help` printed its
long alias as `-watch`, which the parser reads as `-w -a -t -c -h`. A short
form, once shipped, is hard to take back: scripts and habits depend on it.

## Options considered

- **The four letters already used, on every command** (`-f`, `-y`, `-m`, `-o`).
  Consistent, but leaves the most typed flags (`--project`, `--limit`) long.
- **A conventional set** (chosen): nine letters, each one a well-known CLI uses
  for the same thing.
- **The conventional set plus id flags** (`-w --workflow`, `-r --run`,
  `-N --node`, `-k --kind`). More to learn, and `-N` beside `-n` invites typos.

## Decision

- **One table, `SHORT_FLAGS`** (`packages/cli/src/short-flags.ts`): `-a --all`,
  `-d --detach`, `-f --follow`, `-i --input`, `-m --message`, `-n --limit`,
  `-o --output`, `-p --project`, `-y --yes`. A letter means the same flag in
  every command that has it.
- **`-h` and `-v` stay help and version.** `--verbose` gets no letter, and
  neither do `--since`, `--status` and `--severity`, which would all want `-s`.
  `--json`, `--force` and `--dry-run` stay long.
- **No command declares a letter.** `withShortFlags` wraps the root command and
  gives every command, loaded on use or not, its letters. A test walks the real
  command tree and fails on a one-letter alias the table does not give.
- **Code that reads raw arguments matches both spellings** (`flagValues`,
  `isFlag`), and a detached copy (`ORK_DETACHED=1`) never detaches again.
- **Help names a long alias in the description** (`; also --watch`).

## Consequences

- A new flag named like one in the table gets its letter with no change; a new
  letter is a change to the table and to this ADR's list.
- Commands other than the nine lists still ignore a flag they don't have, so a
  letter typed on the wrong command does nothing (L378).

## References

- [Completion and help: short flags](../specs/cli/completion.md#short-flags)
- [Tab completion and short flags](../docs/guides/tab-completion.md#short-flags)
