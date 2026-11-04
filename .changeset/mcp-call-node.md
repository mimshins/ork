---
"@krapht/ork": minor
---

`mcp.call` is a new node that calls one named tool on an MCP server, with no
session and so no model turn. It reads the server from the project's
`.mcp.json`, keeps secrets in your environment and masks them, and a run won't
start if a server is missing or a variable it reads isn't set. Stdio servers and
HTTP servers with static headers work; OAuth and SSE ones are refused.
