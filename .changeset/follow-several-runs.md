---
"@krapht/ork": minor
---

`ork decide --follow` (alias `--watch`) asks every open decision, then each new
one as it opens across all live runs, including a called `build` and runs that
start later; the card names `run <id> · <workflow>`. Ctrl-C ends it with exit 0
and closes nothing; `--until-idle` ends it when no live run is left. It needs a
terminal and refuses `--list`, `--json`, `--ids`, `--limit`, `--id` and
`--choose`. `ork logs -f --all` interleaves every live run (`--project all` for
every project) under a `<id> <workflow> › ` prefix, and takes `--until-idle`.
`ork logs <run>` now prints the runs it called inline under the `call › `
gutter; `--no-calls` prints the caller only, and `--json` includes called runs
only with `--calls`. `ork logs -f <run>` follows called runs and lists those
still running. Tab completion offers the new flags.
