---
"@krapht/ork": minor
---

New: `ork upgrade`, and a notice when a newer Ork is out. Once a day, in the
background, Ork asks the npm registry for the latest version and, when it is
newer, ends a later command with one line saying so. `ork upgrade` upgrades Ork
the way you installed it (npm, pnpm, yarn, bun or Volta), after asking;
`--check` only reports, and `--yes` skips the question. `ork doctor` shows your
version against the last check. The check is off in CI, without a terminal and
with `--json`; `ORK_NO_UPDATE_CHECK=1` turns it off everywhere.
