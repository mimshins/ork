---
"@krapht/ork": minor
---

`ork decide`, permission prompts and every yes-or-no question (`init`,
`migrate`, `upgrade`, `worktrees`, `watch`, `feedback`, `usage`) use the
terminal kit: `ork decide` shows a card with an ASK chip and the node's chip,
the run and "n of m", the question wrapped, the context dimmed (`--verbose` or
`d` shows it all), and options moved with ↑/↓, `j`/`k` or `1`–`9`, with the
recommended one chosen; `q` leaves a question for later and the answered card
collapses to one line. `ork decide --list` shows chips and columns, and
`ork chat` takes its message on a line editor. Plain output (not a terminal,
`NO_COLOR`, `--plain`) keeps the numbered prompts.
