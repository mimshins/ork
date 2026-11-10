---
"@krapht/ork": patch
---

Every node now ends as one known kind (turn limit, budget limit, timed out,
command failed, not signed in, and so on), with Ork's own message as its error
and the raw tool or provider text kept, scrubbed, as the end's detail. Tool,
MCP, call and Claude nodes all set it; a transient kind marks the result
transient. Feedback files a node's end by who should act: Ork's bugs, the
workflow's, or the agent's context, and a report the `report` tool refuses is
the agent's, not an Ork bug.

`ork run` and `ork logs` print a failed node as `✗ <Label>: <message>`, with
`(may pass; ork resume retries)` for a kind that may pass; `--verbose` (and
`ork logs --node <id>`) adds the hint and the scrubbed details. The browser view
shows the same as a badge with the message, the hint and a Details button.
