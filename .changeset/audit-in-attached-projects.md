---
"@krapht/ork": minor
---

`ork run ork:security-audit` works in a project attached with `ork register`.
Ork runs the audit in a git worktree of `HEAD` beside the clone, which holds the
audit's files, and removes it when the run ends. The audit sees `HEAD`, not
uncommitted changes, and its report names the audited commit.
