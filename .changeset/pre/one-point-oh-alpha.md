---
"@krapht/ork": major
---

Ork 1.0.0 begins with this alpha. From here every release is `1.0.0-alpha.N`
until the beta, and a plain `npm install --global @krapht/ork` or
`pnpm add --global @krapht/ork` installs it. Workflow files need no changes. One
behavior to know: a Claude node that names no driver takes the one ready on your
machine (the `claude` CLI when both are) instead of the Agent SDK, and `ork run`
says which; name `driver: sdk` or pass `ork run --driver sdk` to keep the old
behavior. To stay on 0.4, install `@krapht/ork@0.4` and set
`ORK_NO_UPDATE_CHECK=1`.
