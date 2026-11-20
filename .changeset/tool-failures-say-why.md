---
"@krapht/ork": patch
---

Say why an Ork tool call failed. Feedback about a refused or failed Ork tool
call (`tool.arguments`, `tool.error`) now carries the first line of the tool's
own message, at most 300 characters, with secrets and your `env:` values masked,
and one item is kept for each tool instead of one for each node. Only Ork's own
tools are recorded this way. `extract` now says what to send instead when it
refuses a call (an empty `match` text or `search` pattern, a cut that starts a
program, `programs` that is not an array of programs, an unknown field, a path
outside the folder), takes `null` and a JSON string for `steps` and `programs`,
and files a regular expression git cannot compile as the agent's mistake rather
than a failure of Ork.
