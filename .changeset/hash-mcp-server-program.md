---
"@krapht/ork": minor
---

A watched trigger's accepted hash now covers the in-project files an `mcp.call`
check's server runs (its `command` or an argument, also `--config=./x.json`) and
a tool check's `--flag=./file`, so a pulled edit to one turns the trigger off. A
trigger already accepted that names such a file turns off once: run
`ork watch --accept`. OpenCode now fails a node that names an MCP server named
`ork` or starting with `ork_`, naming the server, instead of letting its tools
pass for Ork's own.
