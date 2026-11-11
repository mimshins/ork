---
"@krapht/ork": minor
---

A terminal kit for the CLI's output and prompts: one theme (colored chips,
stable per-node colors), width-aware wrap and cut, and three prompts (select
with ↑/↓, `j`/`k`, `1`–`9`, a note and a details toggle; text; yes or no) that
redraw only their own lines and collapse to one line once answered. Every
command takes a new global `--plain` flag (or `ORK_PLAIN=1`), like `NO_COLOR` or
a non-terminal, for output with no color or redraw and line prompts, for screen
readers and logs. `ork run`'s transcript and summary are the first on it: node
chips, short tool lines (`--verbose` shows each call whole), wrapped agent text
and `RUN`, `OK`, `FAIL` and `WAIT` chips. Other commands move onto the kit in
the following changes.
