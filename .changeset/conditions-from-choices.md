---
"@krapht/ork": minor
---

Tools and MCP calls can declare their output with `output.schema`, and a run
holds every node to what it declared: a value that doesn't fit fails the node
and says why. An edge can now read `ok`, so `when: "!ok"` handles any failure.
In the builder, conditions are picked from what a node can say, new edges start
valid, and renaming a value follows into the conditions that read it.
