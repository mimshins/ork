---
"@krapht/ork": minor
---

Start a worker's next delegated task in a fresh session once its old session has
grown too long. A new project rule, `sessions.freshOver` (a number of tokens, or
`never`, the default), in `.ork/project.yaml` or a workflow's `rules:`, turns it
on for `session: resume` workers whose last task ended `done`. The new session
gets a note of its earlier tasks and reports, works in the same worktree, and
`ork logs` says when it starts fresh. The `claude-code`, `open-code` and
`command-code` drivers now report a session's context size; `codex` does not, so
the rule never fires there.
