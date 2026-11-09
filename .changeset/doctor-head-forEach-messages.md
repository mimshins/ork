---
"@krapht/ork": patch
---

`ork doctor` warns when the repository has no commit (worktree runs branch from
`HEAD`), and `ork init` says so after writing the starter, still exiting 0. The
update line says why the daily check is off here, `ork validate` in a folder
with no `.ork/` says to run `ork init`, and its walk line points to
`ork validate --paths`. A wrong `forEach` (a string, `from` without `maxItems`,
an empty `items`, `maxItems: 0`) or a tool's `list: string` rule now says what
to write. The `fan-out` example's gate still runs when some tasks passed and
others failed.
