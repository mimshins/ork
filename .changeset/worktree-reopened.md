---
"@krapht/ork": patch
---

A child whose worktree was removed outside Ork while the run went on (an agent
ran `git worktree remove`) gets it opened again from its owner's work the next
time it runs, instead of failing with "spawn git ENOENT"; git run in a missing
folder now says which folder.
