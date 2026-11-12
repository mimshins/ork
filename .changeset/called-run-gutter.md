---
"@krapht/ork": patch
---

A called run's lines in `ork attach` and a foreground `ork run` fit the
terminal: they are laid out in the columns the call path (`build › `) leaves, so
a long line wraps under its own text instead of spilling to the terminal's first
column.
