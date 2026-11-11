---
"@krapht/ork": minor
---

`ork once -- <command>` runs a command unless the same check already passed on
identical files (a hash of the working tree, the check's name and Node's
version; `--with-head`, `--covers`, `--force`), and keeps passes in the
repository's git folder, shared by its worktrees. `once: true` on a `verify:` or
a tool node does the same in a workflow, and the run logs a `verify.skipped`
line in `ork logs` and the UI. The test suite uses less CPU: a third of the
cores, fake timers, a compile cache for the CLI's child processes, and shared
fixture repositories.
