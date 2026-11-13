# ork mcp

_Part of [The ork CLI](../cli.md)._

Status: **Built** ([command](../../packages/cli/src/commands/mcp.ts),
[reading](../../packages/server/src/mcp-tools.ts),
[checking and starting](../../packages/server/src/mcp-act.ts),
[tests](../../packages/server/test/mcp.test.ts),
[more tests](../../packages/server/test/mcp-act.test.ts),
[client tests](../../packages/cli/test/mcp.test.ts),
[shared sentences](../../packages/core/src/list-filters/refusals.ts)). Why:
[ADR-057](../../decisions/ADR-057-ork-for-claude-code.md). The plugin that runs
it: [Ork for Claude Code](../claude-code.md).

```
ork mcp [--expects <version>]    # Ork's tools for Claude Code, over stdio
```

`ork mcp` serves Ork's tools to Claude Code as an MCP server on stdio. Claude
Code starts it; a person adds it once with `claude mcp add ork -- ork mcp`. It
is one more client of the store beside the CLI and `ork ui`
([server](../server.md)): each tool answers from the same handler as one of the
API's routes, or the same check as `ork validate`, so the answers agree. It
opens no port, holds no token, and writes nothing but the protocol to stdout.

## Tools

| Tool              | Answers with                                                                           | As                    |
| ----------------- | -------------------------------------------------------------------------------------- | --------------------- |
| `projects`        | The registered projects                                                                | the API's `projects`  |
| `workflows`       | A project's workflows: name, description, inputs, or why one doesn't parse             | `workflows`           |
| `workflow_format` | The format's JSON Schema: the workflow's fields and its node types, or one type's      | `builderSchema`       |
| `agents`          | The agents and skills a project offers                                                 | `builderCatalog`      |
| `runs`            | Runs newest first, with live status and cost; 10 unless `limit` says                   | `runs`                |
| `run`             | One run, by id or a unique start of it, with each node's state                         | `run`, `tree`         |
| `run_events`      | A run's events, oldest first; the newest 30 unless `after`, `limit` or `last` says     | `events`              |
| `usage`           | What runs spent, and how close the limits are                                          | `usage`               |
| `decisions`       | The open decisions (`run`, `project`, `workflow`), and that only a person answers them | `decisions`           |
| `check`           | A draft's `text` or a `workflow`'s problems with their lines, then the walk            | `ork validate`        |
| `explain_context` | What one node's session loads, layer by layer, with tokens                             | `ork context explain` |
| `start_run`       | Starts a workflow in the background and gives its run id                               | `ork run --detach`    |

- **Lists take the CLI's fields.** `runs`, `usage` and `decisions` take the
  fields of their core tables as the API's list routes do
  ([API](../server/api.md#list-routes), [list filters](./list-filters.md)):
  `runs` `status` (`paused` and `crashed` included), `workflow`, `project`,
  `since`, `until` and `limit`; `usage` `workflow`, `project`, `since` (an age,
  a day, an ISO time or `all`) and `until`; `decisions` `workflow`, `run` and
  `project`. A value a table refuses is a tool error in the CLI's words. The
  tool descriptions name them. These three also check what the CLI checks before
  reading: a `project` that is neither `all` nor a registered project's id or
  root is refused with ``No registered project `x`; registered: a, b.`` (`none`
  when there are none), and `runs` `limit` (a number or text) is checked by
  core's `parseLimit`, so `0` or `2.5` gets
  ``--limit takes a positive whole number written in digits, not `0`.`` and not
  a schema error. Both sentences come from core, as the CLI's do
  ([list filters](./list-filters.md#refusals)). The HTTP routes still read an
  unregistered `project` as a root ([L350](../gaps.md#limits)).
- **Nothing acts for a person.** No tool answers a decision, or stops, pauses,
  continues, resumes or messages a run. The reading tools are built from the
  API's read routes alone, and `start_run` from its start route alone. Every
  tool but `start_run` is marked `readOnlyHint`, so Claude Code asks before a
  start. A test holds the list.
- **Nothing starts inside a run.** Where a run's marker (`ORK_RUN` or
  `ORK_SESSION`) is set, as in a session a project's plugin loaded in, there is
  no `start_run`.
- **`check`** takes `text` or `workflow` (a name or a path inside the project),
  not both. It answers the counts of errors and warnings, each diagnostic with
  its line, and the walk's summary; `paths: true` adds its first 20 endings. A
  draft's paths resolve from the project's workflows folder.
- **Short answers.** An answer is JSON on one line, with every string over 400
  characters cut and the rest counted, so one event can't fill a model's
  context. `workflow_format` gives the whole schema, about 50 KB, a part at a
  time.
- **Refusals** are the API's or the CLI's words, as a tool error: a run it can't
  find, a project that isn't registered, an argument a tool doesn't take.
- **`--expects <version>`** is for a caller such as the plugin. When this `ork`
  is older, every call is refused with the version it has, the one needed, and
  `ork upgrade`.
