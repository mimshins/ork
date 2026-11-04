# Call an MCP tool

_Part of [Scripts in a workflow](../scripts.md)._

`mcp.call` calls one named tool on an MCP server, with no session, so no model
turn. It reads the server from your project's `.mcp.json`, the file Claude Code
reads too:

```yaml
issue:
  type: mcp.call
  server: linear
  tool: get_issue
  arguments:
    id: "{{inputs.issue}}"
  output:
    schema:
      state: [open, closed]
  env:
    LINEAR_TOKEN: "{{env.LINEAR_TOKEN}}"
```

A later node reads `{{nodes.issue.output.json.title}}`, and an edge can say
`when: "json.state == 'open'"`.

- **What comes back:** `output.json` for a structured result, or text that is
  JSON, and `output.text` for what it said. A result the server marks as an
  error fails the node.
- **`output: { schema }`** declares the result's fields, as for a
  [program's JSON](../scripts.md). A value that doesn't fit fails the node.
- **`arguments:`** strings are templates. One that is only `{{ … }}` keeps its
  value's type, so a tool that asks for a number gets one.
- **Secrets stay in your environment.** `.mcp.json` reads them as `${VAR}` or
  `${VAR:-default}`, and `env:` can rename one with `{{env.NAME}}`. Ork stores
  none, and a run masks each value it reads this way in all it records, from any
  node. A value that isn't secret goes in the node's `plainEnv`. What is written
  in the file itself, a default included, is not masked, so keep tokens in
  variables. An argument can't read `{{env.NAME}}`, as arguments are recorded.
- **It checks first.** A run won't start if a server isn't in `.mcp.json`, its
  program isn't installed, or a variable it reads isn't set.
- **It takes stdio servers and HTTP servers with static headers.** A server that
  needs an OAuth sign-in is refused, as those tokens are Claude Code's, and so
  is an SSE one. For those, call the tool from a session.
- **It starts the server for each call,** so it suits a few calls, not hundreds.
- **`timeout:`** limits the whole call, starting the server included; with none,
  the node's default applies.
- **It asks for no permission.** You named the tool in the workflow, as you name
  the command of a tool node.
