---
"@krapht/ork": minor
---

Every run is now recorded in `~/.ork/state.db` (Node's built-in SQLite), with a
copy in the project's `.ork/runs/<run>/events.jsonl`, secrets masked. New:
`ork ps` lists runs, `ork logs` replays or follows a run's transcript (`--node`,
`--follow`, `--json`), and `ork tree` shows the ownership tree with each node's
state, tokens and cost. `ork run` now checks, before anything starts, that the
programs its tool nodes run are installed, so integrations stay optional: only
the ones a workflow uses must be there. `ork doctor` says so, and
`ork context explain` accepts a workflow name like `ork run`.
