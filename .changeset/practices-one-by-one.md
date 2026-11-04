---
"@krapht/ork": patch
---

A workflow or node that sets one built-in practice no longer undoes the other.
Before, `defaults: { practices: { ponytail: ultra } }` in a workflow switched
caveman back on when `.ork/project.yaml` had turned it off, and a node's
`practices:` did the same to its agent's.
