---
"@krapht/ork": patch
---

`ork once --on` refuses pathspecs that match no file, and `--on` or `--covers`
with no value (`--on --force`), before the command runs. A prompt withdrawn
before it parks is withdrawn at once, so `ork decide --follow` ends the prompt
that took a Ctrl-C without waiting a tick. In `ork ui`, a filter refused before
any has worked says "Nothing is filtered yet." Internal: the tests fail when
they read a file the tests' `--on` list leaves out, Ctrl-C on a real terminal is
tested for `decide --follow` and `logs -f --all`, and the audit consolidates
after a failed coverage critic and marks the run incomplete.
