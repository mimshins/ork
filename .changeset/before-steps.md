---
"@krapht/ork": minor
---

A leader or worker can now run `before:`, a program in its own checkout before
its session starts. If it fails, no model turn is spent, and its prompt can read
what it gave as `{{before.*}}`. `defaults:` can set one for every node in a
workflow or project.
