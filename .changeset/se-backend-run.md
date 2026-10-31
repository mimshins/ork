---
"@krapht/ork": patch
---

`ork worktrees` now shows the branch a workflow made in a worktree Ork created
detached (`commit: never`, then `tool.git` `switch -c`), with its unmerged
commits, instead of "detached, nothing committed"; `clean` never deletes that
branch. A workflow drafted by `ork migrate --from-agents` takes a `message`
input for its commit instead of using the task.
