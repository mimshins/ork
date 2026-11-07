---
"@krapht/ork": patch
---

A run that crashed is no longer shown as running after its process id is reused,
by a process started after a reboot or by another user. Ork now records when a
run's process started, beside its id, and a live process with that id but
another start reads as `crashed`, so `ork ps`, `ork stop`, `ork prune`,
`ork worktrees` and the browser view see it as crashed, and an upgrade no longer
waits on it. Runs recorded before this change are judged as they were.
