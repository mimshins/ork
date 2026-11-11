---
"@krapht/ork": minor
---

Runs are lighter on your machine. A project's new `heavy` rule names its
full-suite commands (`pnpm check`, `pnpm test`, `vitest run`): a node with
`verify:` may no longer run them in its session, since Ork runs that check, and
each takes one of 2 machine-wide slots (`ORK_HEAVY_SLOTS` changes the count), so
three checks at once no longer heat the machine. A wait shows in `ork ps`, the
logs and the browser view, and doesn't count towards a timeout. A new `priority`
rule starts sessions and tool commands at a lower OS priority by default
(`priority: normal` turns it off). `ork usage --by node` shows the CPU each
node's tool commands used, and the browser view's overview no longer re-reads
every event of every running run each second.
