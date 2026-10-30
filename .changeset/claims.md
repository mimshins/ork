---
"@krapht/ork": minor
---

New: `claim` and `release` for nodes that write at the same time. A node claims
a file, folder or other shared resource before it edits it; an overlapping claim
is refused with who holds it, and the node is told when it is released. Claims
are released when a node finishes, and `ork logs` shows them.
