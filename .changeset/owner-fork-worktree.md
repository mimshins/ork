---
"@krapht/ork": patch
---

A leader with its own worktree is forked to answer its children's questions
(`questions: owner`); the fork's plan used to fail on the default `worktree`
isolation, so the question went to the person with no fork.
