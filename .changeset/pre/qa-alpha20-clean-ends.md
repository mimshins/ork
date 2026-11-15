---
"@krapht/ork": patch
---

A reader that closes stdout early (`ork logs -f --all | head`) ends `ork`
quietly; `ork decide`'s plain prompt takes `q` or the end of input as "later";
`ork logs` refuses `--calls` with `--no-calls`; an unreadable store is one line
for the list commands; zsh completion drops the stray `--` after plain values.
