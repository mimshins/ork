---
"@krapht/ork": patch
---

Claude Code sessions give each Bash command up to ten minutes before moving it
to the background (`BASH_DEFAULT_TIMEOUT_MS=600000`). At Claude Code's default
of two minutes, a long check went to the background and the agent polled it with
`until` or `Monitor`, asking the maintainer to approve each wait.
