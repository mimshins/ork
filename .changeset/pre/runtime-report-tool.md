---
"@krapht/ork": patch
---

Ork's MCP endpoint has a `report` tool for drivers that cannot hold a final
answer to a JSON Schema themselves (`open-code`, `command-code`). It checks the
report against the node's report schema and returns each violation to the model
so it can fix the report and call again; the session ends with the last report
it accepted. `claude-code` keeps its structured output and does not get the
tool.
