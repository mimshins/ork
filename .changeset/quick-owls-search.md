---
"@krapht/ork": patch
---

`extract` accepts a `glob`, `context`, `regex`, `max` and several paths in
`search`, and a `path` on `count`; a missing `search` path is refused as the
agent's mistake, and a `files` glob without a `/` matches names at any depth.
