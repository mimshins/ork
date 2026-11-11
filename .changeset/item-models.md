---
"@krapht/ork": minor
---

A Claude node's `model` and `effort` can be `{{item.<field>}}` on a `forEach`
node, so each item runs on its own model. `ork validate` checks written items,
an item from `from:` is checked when it runs, and the builder shows a templated
`effort` as text, and `ork chat` resumes an item on its own model. `build`'s
review now runs one Opus and two Sonnet reviewers.
