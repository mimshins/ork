---
"@krapht/ork": minor
---

`ork ui` tells you when a newer Ork is out, with a banner above the panels from
the same record as the CLI's notice; it keeps that record fresh itself while it
stays open, at most once a day, and `ORK_NO_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER`
and `CI` turn it off. **Upgrade…** (or **Upgrade Ork…** in the palette) does
what `ork upgrade` does once you confirm: it shows the exact command, streams
its output, and offers **Restart**, which brings `ork ui` back on the new
version on the same port, still signed in, and reloads the page. A clone or an
`npx` copy gets the steps to run instead, each command as a block. The dialog
works by keyboard and screen reader: each step's heading takes the focus and is
heard, the plan and the outcome are said aloud, and closing it returns the focus
to the banner's button, or to the panels. `ork ui` now runs its server as a
child process it supervises; Ctrl-C still stops both.
