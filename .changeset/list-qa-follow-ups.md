---
"@krapht/ork": minor
---

The list commands now do what the filtering guide says. `--all` is removed from
`ork ps`, `usage`, `decide`, `follow-ups list` and `feedback list` (it is
refused like any unknown flag): use `--project all` on the first four and
`--status all` on `feedback list`; `prune --all`, `worktrees clean --all`,
`relay list --all` and `feedback export --all` are unchanged. The nine list
commands refuse a flag they don't have (``Unknown flag `--since`.``), and an
argument error on any command with no subcommands prints one line instead of the
help. `--run` on `feedback list` and `worktrees list` takes the start of a run
id and refuses an unknown one, as `decide` does;
`follow-ups list --for project:<name>` is checked against the registered
projects; `--limit 1e21` says the number must be written in digits;
`ork ps --json` rows carry `live`, the status the table shows. `ork mcp`'s
`runs`, `usage` and `decisions` refuse an unregistered `project`, and `runs` a
bad `limit`, in the CLI's words. In the browser view a refused first filter
shows the unfiltered list, the filter bar's command is the last filter that
worked, the Usage hint says `--project all`, and the Decisions bar suggests
projects.
