# ork mcp

_Part of [The ork CLI](../cli.md)._

Status: **Partial**: the reading tools are built
([command](../../packages/cli/src/commands/mcp.ts),
[tools](../../packages/server/src/mcp-tools.ts),
[tests](../../packages/server/test/mcp.test.ts),
[client tests](../../packages/cli/test/mcp.test.ts)). Checking a draft, starting
a run, the skills and the plugin are to come
([RFC-012](../../rfcs/active/RFC-012-teaching-claude-code-ork.md)).

```
ork mcp                          # Ork's tools for Claude Code, over stdio
```

`ork mcp` serves Ork's tools to Claude Code as an MCP server on stdio. Claude
Code starts it; a person adds it once with `claude mcp add ork -- ork mcp`. It
is one more client of the store beside the CLI and `ork ui`
([server](../server.md)): each tool answers from the same handler as one of the
API's routes, so the answers agree. It opens no port, holds no token, and writes
nothing but the protocol to stdout.

## Tools

| Tool              | Answers with                                                                       | As the API's     |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------- |
| `projects`        | The registered projects                                                            | `projects`       |
| `workflows`       | A project's workflows: name, description, inputs, or why one doesn't parse         | `workflows`      |
| `workflow_format` | The format's JSON Schema: the workflow's fields and its node types, or one type's  | `builderSchema`  |
| `agents`          | The agents and skills a project offers                                             | `builderCatalog` |
| `runs`            | Runs newest first, with live status and cost; 10 unless `limit` says               | `runs`           |
| `run`             | One run, by id or a unique start of it, with each node's state                     | `run`, `tree`    |
| `run_events`      | A run's events, oldest first; the newest 30 unless `after`, `limit` or `last` says | `events`         |
| `usage`           | What runs spent, and how close the limits are                                      | `usage`          |
| `decisions`       | The open decisions, and that only a person answers them                            | `decisions`      |

- **Read only.** The tools are built from the API's read routes and the
  builder's catalog alone, so none can answer a decision, start, stop, pause,
  continue, resume or message a run. Each is marked `readOnlyHint`. A test holds
  the list.
- **Short answers.** An answer is JSON on one line, with every string over 400
  characters cut and the rest counted, so one event can't fill a model's
  context. `workflow_format` gives the whole schema, about 50 KB, a part at a
  time.
- **Refusals** are the API's words, as a tool error: a run it can't find, a
  project that isn't registered, an argument a tool doesn't take.
