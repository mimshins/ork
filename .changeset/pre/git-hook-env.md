---
"@krapht/ork": patch
---

Ork run from a git hook acts on its own repositories, not the hook's: `ork`
clears git's local variables (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` and
the rest of `git rev-parse --local-env-vars`) as it starts, so its sessions,
tool nodes and detached runs start clean, and its own git runner leaves them out
too. An outer `git -c key=value` no longer reaches Ork's git.
