---
"@krapht/ork": patch
---

`ork mcp` refuses an argument a tool doesn't take, rather than drop it, and
`ork init --skills` keeps a copy of Ork's skills that a newer Ork wrote. The
Claude Code plugin's hook stops `ork decide` only when it answers (`--id` or
`--choose`), whatever else is on the line, and lets listing through; the plugin
expects the oldest Ork it works with, not the newest release.
