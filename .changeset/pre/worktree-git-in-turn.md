---
"@krapht/ork": patch
---

Two children a leader starts at once no longer fail with "git add failed: remove
the file manually to continue". Ork runs its git commands in one worktree one at
a time, so their hand-offs from the leader's worktree don't collide on its
index.
