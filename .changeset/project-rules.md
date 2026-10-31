---
"@krapht/ork": minor
---

New: project rules. `.ork/project.yaml` says what Ork may do on its own in your
project, and a workflow's `rules:` override it. `git.commit: never` runs no
commit at all: worktrees are detached, work stays uncommitted, and a passing
child's changes are applied to its owner's worktree (`merge: patch`).
`merge: never` keeps every child's worktree. `git.base`, `git.branch` and
`git.worktrees` take templates such as `{inputs.type}/{inputs.slug}`. The file
also sets `permissions` for every Claude node, `defaults`, and `context` files.
Ork still never pushes, never takes over a branch it did not create, and
`ork worktrees` now lists what runs recorded creating, whatever it is called.

New: `session: resume | fresh` on leaders, workers and agents, so a reviewer can
keep its session across a loop's rounds.
