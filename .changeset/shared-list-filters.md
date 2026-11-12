---
"@krapht/ork": minor
---

Every list command filters the same way. `ork ps`, `usage`, `decide --list`,
`follow-ups list`, `feedback list`, `worktrees list`, `agents list` and
`projects` take flags made from one field table per list (`--status`, `--kind`,
`--severity`, `--for`, `--due`, `--workflow`, `--run`, `--project`, `--source`,
`--since`, `--until`), with the allowed values checked and offered by Tab
completion; `ork logs` takes `--since`, `--until` and `--limit`. Every list
takes `--ids` (the ids, comma-separated on one line, for `$(...)`; not on
`usage` or `logs`), `--limit` (a positive whole number; anything else is an
error) and `--json`. `--since` and `--until` read an age (`24h`, `30d`, `12w`)
or a day (`2026-11-01`) on every list. `--all` is deprecated: use
`--project all` or `--status all`; it still works for one release, prints a
warning, and is left out of `--help` and Tab completion. `prune --all` is
unchanged.
