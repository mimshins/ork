---
"@krapht/ork": minor
---

A `tool.shell` node can now hold a short program as `script:`, instead of
`command:`. It takes no templates, so a value can't become code: values arrive
through `env:`. It runs under `sh -eu` by default, or the `interpreter:` it
names.
