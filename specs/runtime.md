# Runtime: the Claude drivers

Status: **Built**: the port, both drivers and Ork's MCP tools, tested against a
stand-in `claude` ([code](../packages/runtime-claude/src/index.ts),
[tests](../packages/runtime-claude/test/runtime.test.ts)), and run one node at a
time by [`ork run --node`](./cli/running-and-runs.md#running-one-node). Why:
[ADR-004](../decisions/ADR-004-no-credentials.md),
[ADR-005](../decisions/ADR-005-one-runtime-port-two-drivers.md),
[ADR-010](../decisions/ADR-010-reports-as-structured-output.md),
[ADR-011](../decisions/ADR-011-in-house-mcp-server.md),
[ADR-065](../decisions/ADR-065-clean-claude-sessions.md) (sessions start clean
of the machine's Claude setup; built and tested on both drivers' arguments).

## The port

`@krapht/ork-core` defines the port
([runtime/types.ts](../packages/core/src/runtime/types.ts));
`@krapht/ork-runtime-claude` implements it; tests implement it with a fake.

| Type             | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClaudeRuntime`  | `{ driver: "sdk" \| "cli"; start(spec, ports): Session }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SessionPorts`   | what the session reaches besides its spec: the `HumanChannel`, for a leader in a run its `Ownership` (children, worker templates, `delegate`, `spawn`; [scheduler](./scheduler.md#delegation)), for a leader or worker in a run its `Mailbox` on the [message bus](./messaging.md#message-bus), and in a run its `HoldPort` ([run control](./run-control.md#pause))                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SessionSpec`    | node id, `cwd`, `model`, `effort`, Ork's `plugins` and extra `settings` ([context](./context.md#how-a-nodes-session-is-compiled)), the rendered brief (`prompt`), `systemAppend`, `settingSources` (`project`, `local`; never `user`), tool rules (`allow`, `deny`, `only`: the only built-in tools, `strictMcp`: no MCP server but Ork's, `--strict-mcp-config` on the CLI driver, `strictMcpConfig` on the SDK), permission mode, `maxTurns`, `budgetUsd`, the report schema, `resume`, `fork` (with `resume`, a copy of that session: `--fork-session` on the CLI driver, `forkSession` on the SDK; [leader questions](./messaging/leader-questions.md)), `promptCache` (`1h` for a leader), `machineClaude` (load the machine's MCP servers and auto-memory; [what a session loads](#what-a-session-loads)) |
| `Session`        | `events` (an async iterable of `RuntimeEvent`), `send(text)` (a user message with `priority: "next"`: Claude Code shows it at the session's next step, mid-turn or not), `interrupt()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RuntimeEvent`   | `session.started` (with the session's `cwd` and `driver`, so `ork chat` can resume it), `assistant.text`, `tool.called`, `tool.result`, `session.finished` (with the outcome)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SessionOutcome` | `subtype` (`success` or the driver's error subtype, e.g. `error_max_turns`, `error_driver`), session id, the report or `null`, the final text, usage, errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `HumanChannel`   | `permit(tool request)` and `ask(question, options, recommended, context, document)`, each with an optional `onNote` that takes the person's [note](./messaging.md#decisions) before the answer resolves; in a run it is the decision queue, where the terminal ([CLI](./cli/running-and-runs.md#questions-and-permissions-on-the-terminal)) races `ork decide` ([messaging](./messaging.md))                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Holding a session** ([hold.ts](../packages/runtime-claude/src/hold.ts),
[tests](../packages/runtime-claude/test/hold.test.ts), ADR-041): with a
`HoldPort`, each driver adds a `PreToolUse` hook (the CLI driver an HTTP hook to
its endpoint's `/hold`, the SDK driver a callback) that waits while the node is
paused; past the 9-minute window it defers the call, and the driver resumes the
session once the node continues, yielding one session.

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
| System prompt         | `{ type: "preset", preset: "claude_code", append, excludeDynamicSections: true }`                    | `--append-system-prompt`, `--exclude-dynamic-system-prompt-sections`                        |
| Report                | `outputFormat: { type: "json_schema", schema }`                                                      | `--json-schema`                                                                             |
| Ork's tools           | an in-process SDK MCP server named `ork`; `strictMcpConfig: true` unless `machineClaude`             | Ork's local MCP server, passed with `--mcp-config`; `--strict-mcp-config` unless the same   |
| Permission prompts    | `canUseTool` → `HumanChannel.permit`                                                                 | `--permission-prompt-tool mcp__ork__permission` → `HumanChannel.permit`                     |
| Tool rules            | `allowedTools` (+ Ork's preapproved tools), `disallowedTools`                                        | `--allowedTools` (+ the same), `--disallowedTools`                                          |
| Model and effort      | `model`, `effort`                                                                                    | `--model`, `--effort`                                                                       |
| Ork's skills          | `plugins: [{ type: "local", path }]`                                                                 | `--plugin-dir`                                                                              |
| Extra settings        | `settings` (e.g. `skillOverrides`)                                                                   | `--settings <json>`                                                                         |
| Limits and resume     | `maxTurns`, `maxBudgetUsd`, `resume`                                                                 | `--max-turns`, `--max-budget-usd`, `--resume`                                               |
| A leader's cache      | `env` with `ENABLE_PROMPT_CACHING_1H=1`                                                              | the same variable in the `claude` process's environment                                     |
| Auto-memory           | `env` with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` unless `machineClaude`                                | the same variable in the `claude` process's environment                                     |
| A failure to start    | a `session.finished` event with `subtype: "error_driver"`                                            | the same, with the last stderr line                                                         |

## Which driver a session uses

One rule, for every caller ([driver.ts](../packages/core/src/run/driver.ts)):
`--driver`, else the node's `driver` (or its agent's), else the workflow's
`defaults.driver` (the project's `.ork/project.yaml` default included), else the
driver ready on the machine running it. A workflow is committed, so nothing
writes one person's driver into it; `ork init`'s starter names none.

- **The one ready** is what `ork doctor`'s own checks find
  ([ready.ts](../packages/integrations/src/ready.ts)): a `claude` login makes
  `cli` ready; `ANTHROPIC_API_KEY`, Bedrock, Vertex or Foundry makes `sdk`
  ready. With both, a run takes `cli`.
- **`ork run` looks once, before anything starts**, and only when a session node
  names no driver and `--driver` isn't given
  ([ready-driver.ts](../packages/cli/src/run/ready-driver.ts)). It says so in
  one line on stderr:
  `No driver is named, so the run uses the cli driver: the one ready here (…).`,
  or `review names no driver, so it uses …` when only some name none. With
  neither ready the run doesn't start: it names the nodes and gives each
  driver's hint, as `ork doctor` does.
- **The run records it** (`settings.readyDriver` on `run.started`), and
  `ork resume` keeps it, without looking again. A run recorded before this has
  none, and a resume looks.
- `--node` looks the same way for its node; `ork chat` resumes a session on the
  driver it ran with. Detached runs, called runs, the server's Run workflow and
  Propose fix, and the MCP `start_run` all start `ork run`, so they look the
  same way, on the machine running it.
- Tests pass their own checks, so no real `claude` runs
  ([tests](../packages/cli/test/ready-driver.test.ts)).

## What a session loads

Every Claude session of a run (workers, leaders, a leader's question fork, on
either driver) starts **clean of the machine's Claude setup**
([clean.ts](../packages/runtime-claude/src/clean.ts),
[tests](../packages/runtime-claude/test/clean.test.ts), ADR-065):

- **The repository's setup loads**: `settingSources` stays `project`, `local`,
  so `CLAUDE.md`, `AGENTS.md` and `.claude/`'s agents, skills and settings load,
  with Ork's own plugins and context. User-level `~/.claude` settings never do.
- **No MCP server but Ork's**: `--strict-mcp-config` (the SDK's
  `strictMcpConfig`), so neither `~/.claude.json`'s servers, nor those
  registered for the folder, nor a project's `.mcp.json` or plugins' servers
  load. Their set changing mid-session rewrote the prompt cache: the same 4-turn
  task on `claude` 2.1.319 cost $0.113 loose and $0.032 strict. The servers a
  node names load too (below).
- **No auto-memory**: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the session's
  environment, so the machine user's notes under
  `~/.claude/projects/<folder>/memory/` stay out.
- **The per-machine prompt sections leave the cached prefix**:
  `--exclude-dynamic-system-prompt-sections` (the SDK's
  `excludeDynamicSections: true`) moves the working directory, memory path and
  git status into the first user message. It changes no content, so it stays on
  either way.

**`ork run --machine-claude`** turns the first two back: the run's sessions load
the machine's MCP servers and auto-memory as `claude` would. The run records it
once (`settings.machineClaude` on `run.started`, beside `readyDriver`), and
`ork resume`, `ork chat` and every run it calls (`workflow.call`, which starts
`ork run --machine-claude`) keep it; `ork resume` takes no flag of its own. A
run recorded before it resumes clean. `--node` takes it too. The Run workflow
form's "Use this machine's Claude setup" box adds it ([server](./server.md)). A
leader's question fork stays strict either way: it sets `strictMcp` itself
([leader questions](./messaging/leader-questions.md)).

**A node names the servers it needs** (`mcp:` on a leader, a worker or
`defaults`, [ADR-067](../decisions/ADR-067-nodes-name-mcp-servers.md),
[tests](../packages/runtime-claude/test/mcp-servers.test.ts)). `SessionSpec`'s
`mcpServers` holds those entries of the project's `.mcp.json`, as written, and
both drivers add them beside Ork's: the CLI's `--mcp-config`, the SDK's
`mcpServers`. Strict stays on, so nothing else loads. Naming a server adds
`mcp__<name>` to the node's allow list (deny rules win). `${VAR}` stays text:
`claude` expands it on either driver, because the SDK passes these entries to it
as `--mcp-config`. The sessions the CLI starts itself (`ork run --node`,
`ork chat`) load them too. A leader's question fork loads none.

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
sum. The same holds across a resume: a resumed session's cost is the session's
total so far, when its transcript saved one, while its tokens, turns and
duration are that process's own; a crash's result may carry zero
([usage](./usage.md#what-a-resumed-session-spent)).

## Limits

What the drivers do for now, by choice. The gaps review kept C5, and carried a
threshold for L171 to the cost benchmark ([register](./gaps.md#limits)).

- **C5 · The SDK driver is covered by unit tests only.** No paid run has used
  it: the examples ran end to end on the CLI driver (2026-10-31), and pause,
  links, timeouts, calls and steps have met real sessions on the CLI driver
  only. On the SDK driver each is checked against the SDK's types and a
  stand-in, its pause (the hold hook and deferred resume) included. Nor is it
  measured whether the SDK driver lets a session retry a value outside a Claude
  schema, as the CLI driver does; Ork checks the value too, so a bad one fails
  either way. ([examples](../docs/guides/examples.md),
  [run control](./run-control.md#limits))
- **L171 · A Claude report's fields are not cut.** A tool's output over 64 KiB
  is cut, and the whole kept in a run file it names by path
  ([scheduler](./scheduler.md#built-in-node-types)). A Claude report's `summary`
  and `output.schema` fields pass through whole, however long, into the run's
  record and any prompt that reads them. A report names big outputs as files
  under `artifacts`, by path. ([context](./context.md))
