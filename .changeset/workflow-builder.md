---
"@krapht/ork": minor
---

`ork ui` has a Builder panel: create or edit a workflow with no YAML to write.
It saves the same file you could write by hand, keeping its comments, and what
you change waits as a draft until it passes the same checks as `ork validate`.

Cards now always follow from a workflow's nodes and edges, so
`<name>.layout.json` is no longer read. A file left behind is ignored and can be
deleted.
