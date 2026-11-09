---
"@krapht/ork": patch
---

Show why `claude` really died instead of the `Node.js v24` banner, say
`interrupted` after a signal or a stop, keep a failed program item's `exitCode`
and `error` in `results`, name `output.json.<field>` when a `forEach` reads a
tool's list elsewhere, count only started items as ran, refuse `ork logs --node`
for a node the run never had, and start a new paragraph after a list in a gate's
text.
