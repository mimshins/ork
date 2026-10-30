# Runtime: the Claude drivers

Status: **Built**: the port, both drivers and Ork's MCP tools, tested against a
stand-in `claude` ([code](../packages/runtime-claude/src/index.ts),
[tests](../packages/runtime-claude/test/runtime.test.ts)), and run one node at a
time by [`ork run --node`](./cli.md#running-one-node). Why:
[ADR-004](../decisions/ADR-004-no-credentials.md),
[ADR-005](../decisions/ADR-005-one-runtime-port-two-drivers.md),
[ADR-010](../decisions/ADR-010-reports-as-structured-output.md),
[ADR-011](../decisions/ADR-011-in-house-mcp-server.md).

## The port

`@krapht/ork-core` defines the port
([runtime/types.ts](../packages/core/src/runtime/types.ts));
`@krapht/ork-runtime-claude` implements it; tests implement it with a fake.

| Type             | What it is                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ClaudeRuntime`  | `{ driver: "sdk" \| "cli"; start(spec, ports): Session }`                                                                                                                                                                                                                                                                |
| `SessionPorts`   | what the session reaches besides its spec: the `HumanChannel`, and for a leader in a run its `Ownership` (children, worker templates, `delegate`, `spawn`; [scheduler](./scheduler.md#delegation))                                                                                                                       |
| `SessionSpec`    | node id, `cwd`, `model`, `effort`, Ork's `plugins` and extra `settings` ([context](./context.md#how-a-nodes-session-is-compiled)), the rendered brief (`prompt`), `systemAppend`, `settingSources` (`project`, `local`; never `user`), tool rules, permission mode, `maxTurns`, `budgetUsd`, the report schema, `resume` |
| `Session`        | `events` (an async iterable of `RuntimeEvent`), `send(text)` (delivered between turns), `interrupt()`                                                                                                                                                                                                                    |
| `RuntimeEvent`   | `session.started`, `assistant.text`, `tool.called`, `tool.result`, `session.finished` (with the outcome)                                                                                                                                                                                                                 |
| `SessionOutcome` | `subtype` (`success` or the driver's error subtype, e.g. `error_max_turns`, `error_driver`), session id, the report or `null`, the final text, usage, errors                                                                                                                                                             |
| `HumanChannel`   | `permit(tool request)` and `ask(question, options, recommended, context)`; the CLI answers on the terminal ([cli.md](./cli.md#questions-and-permissions-on-the-terminal)) until the decision queue (M1d) replaces it                                                                                                     |

Both drivers emit the same message JSON (the Agent SDK's messages are the CLI's
`stream-json` lines), so one normalizer serves both
([normalize.ts](../packages/runtime-claude/src/normalize.ts)).

## The node report

A Claude node ends with **structured output**, not a tool call
([runtime/report.ts](../packages/core/src/runtime/report.ts)):

- The JSON Schema has `status` (`pass`, `changes_requested`, `fail`, `done`),
  `summary`, `artifacts` (name → repository-relative path), `branch`, and one
  property per field of the node's `output.schema`. A list in `output.schema` is
  an enum, a primitive name (`string`, `number`, `integer`, `boolean`) is that
  type, and an object is taken as JSON Schema.
- `status`, `summary` and every `output.schema` field are required.
- A session without a valid report has `report: null`; the scheduler treats it
  as `fail`.

## The drivers

| Concern               | SDK driver ([sdk.ts](../packages/runtime-claude/src/sdk.ts))                                         | CLI driver ([cli.ts](../packages/runtime-claude/src/cli.ts))                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Process               | `query()` from `@anthropic-ai/claude-agent-sdk`, in Ork's process                                    | the user's own `claude -p --input-format stream-json --output-format stream-json --verbose` |
| Credentials           | **Refuses to start** without `ANTHROPIC_API_KEY` or `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1` | whatever the user's `claude` is logged in with; Ork never reads it                          |
| Brief and later input | an input queue of user messages; the first result closes it                                          | stream-json lines on stdin; the first result ends stdin                                     |
| System prompt         | `{ type: "preset", preset: "claude_code", append }`                                                  | `--append-system-prompt`                                                                    |
| Report                | `outputFormat: { type: "json_schema", schema }`                                                      | `--json-schema`                                                                             |
| Ork's tools           | an in-process SDK MCP server named `ork`                                                             | Ork's local MCP server, passed with `--mcp-config`                                          |
| Permission prompts    | `canUseTool` → `HumanChannel.permit`                                                                 | `--permission-prompt-tool mcp__ork__permission` → `HumanChannel.permit`                     |
| Tool rules            | `allowedTools` (+ Ork's preapproved tools), `disallowedTools`                                        | `--allowedTools` (+ the same), `--disallowedTools`                                          |
| Model and effort      | `model`, `effort`                                                                                    | `--model`, `--effort`                                                                       |
| Ork's skills          | `plugins: [{ type: "local", path }]`                                                                 | `--plugin-dir`                                                                              |
| Extra settings        | `settings` (e.g. `skillOverrides`)                                                                   | `--settings <json>`                                                                         |
| Limits and resume     | `maxTurns`, `maxBudgetUsd`, `resume`                                                                 | `--max-turns`, `--max-budget-usd`, `--resume`                                               |
| A failure to start    | a `session.finished` event with `subtype: "error_driver"`                                            | the same, with the last stderr line                                                         |

## Ork's MCP server (CLI driver)

[mcp-http.ts](../packages/runtime-claude/src/mcp-http.ts) serves one session:

- on `127.0.0.1` only, on a random port, behind a per-session bearer token
  compared in constant time;
- MCP's streamable HTTP transport with plain JSON replies (no SSE stream):
  `initialize`, `ping`, `tools/list`, `tools/call`; notifications get `202`;
  `GET` and other methods get `405`; bodies over 1 MiB get `413`;
- tools: what the registry binds for the session ([messaging](./messaging.md)):
  `ask_user`, `permission` (the CLI's permission-prompt contract, answering
  `{"behavior":"allow"|"deny", …}`), and for leaders `delegate` and
  `spawn_worker`; arguments are validated with Zod;
- a per-server `timeout` of 24 hours in `--mcp-config`: the CLI otherwise ends
  an HTTP request after 60 seconds and drops a call silent for 5 minutes, and
  `delegate` waits for whole child sessions. `MCP_TOOL_TIMEOUT` (about 28 hours
  by default) still caps it. The SDK's in-process server has neither limit.

## Usage accounting

The outcome's usage comes from the final `result` message: cost (a client-side
estimate), input, output, cache-read and cache-write tokens, turns and duration.
In streaming mode a later result carries running totals; read the latest, never
sum.
