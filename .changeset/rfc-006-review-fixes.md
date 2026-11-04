---
"@krapht/ork": patch
---

Fixes to checks, setup steps and MCP calls. A failed `verify:` now sends the
real end of a long output, and a long error line no longer reaches the session
whole. A resume stays within `maxTurns`, and a re-entered leader no longer loses
a retry it can afford. A message that arrives during a passing check gets read.
A node stopped or paused during `before:` starts no session. A run masks what
`.mcp.json` reads across all its nodes, `plainEnv` works there, and numbers are
masked in results. A server's slow start no longer fails at 60 seconds. A run no
longer refuses a relative program it can't yet see, and `when: before.x` is now
a compile error.
