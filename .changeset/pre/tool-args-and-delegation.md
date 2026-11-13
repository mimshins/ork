---
"@krapht/ork": patch
---

A tool node's argument that starts with a `{{nodes.<id>.output…}}` value which
begins with `-` now fails the node ("argument from nodes.a.output starts with
`-`; put `--` before it in the command") unless a `--` comes before it, so a
node's output can't pass an option to the program. Two `delegate` calls at once
for the same child start it once, and the other is told `already running`. On
OpenCode, Ork allows its own tools by their exact names, so a project MCP server
named `ork_<something>` no longer inherits that allow. Upgrade: a tool node
whose output-fed argument can start with `-` needs a `--` before it.
