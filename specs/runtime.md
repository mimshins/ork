# Runtime: the agent drivers

Status: **Built**: the port, the adapter strategies and session runner, the
`claude-code` driver and Ork's MCP tools, tested against a stand-in `claude`;
the [`open-code`](./runtime/open-code.md) and
[`command-code`](./architecture/command-code.md) drivers are built and unproven
([code](../packages/runtime/src/index.ts),
[tests](../packages/runtime/test/runtime.test.ts)), and run one node at a time
by [`ork run --node`](./cli/running-and-runs.md#running-one-node). Why:
[ADR-004](../decisions/ADR-004-no-credentials.md),
[ADR-005](../decisions/ADR-005-one-runtime-port-two-drivers.md),
[ADR-010](../decisions/ADR-010-reports-as-structured-output.md),
[ADR-011](../decisions/ADR-011-in-house-mcp-server.md),
[ADR-065](../decisions/ADR-065-clean-claude-sessions.md), and
[RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md) (removed the SDK
driver).

## The port

`@krapht/ork-core` defines the port
([runtime/types.ts](../packages/core/src/runtime/types.ts));
`@krapht/ork-runtime` implements it; tests implement it with a fake.

| Type             | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentRuntime`   | `{ driver: "claude-code" \| "open-code" \| "command-code"; start(spec, ports): Session }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SessionPorts`   | what the session reaches besides its spec: the `HumanChannel`, for a leader in a run its `Ownership` (children, worker templates, `delegate`, `spawn`; [scheduler](./scheduler.md#delegation)), for a leader or worker in a run its `Mailbox` on the [message bus](./messaging.md#message-bus), and in a run its `HoldPort` ([run control](./run-control.md#pause))                                                                                                                                                                                                                                                                                                                                                 |
| `SessionSpec`    | node id, `cwd`, `model`, `effort`, Ork's `plugins` and extra `settings` ([context](./context.md#how-a-nodes-session-is-compiled)), the rendered brief (`prompt`), `systemAppend`, `settingSources` (`project`, `local`; never `user`), tool rules (`allow`, `deny`, `only`: the only built-in tools, `strictMcp`: no MCP server but Ork's, `--strict-mcp-config`), permission mode, `maxTurns`, `budgetUsd`, the report schema, `resume`, `fork` (with `resume`, a copy of that session: `--fork-session`; [leader questions](./messaging/leader-questions.md)), `promptCache` (`1h` for a leader), `machineClaude` (load the machine's MCP servers and auto-memory; [what a session loads](#what-a-session-loads)) |
| `Session`        | `events` (an async iterable of `RuntimeEvent`), `send(text)` (a user message with `priority: "next"`: Claude Code shows it at the session's next step, mid-turn or not), `interrupt()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `RuntimeEvent`   | `session.started` (with the session's `cwd` and `driver`, so `ork chat` can resume it), `session.waiting` (with a `reason`: the session waits before its tool starts, e.g. for its checkout on `command-code`; nothing derives from it), `assistant.text`, `tool.called`, `tool.result`, `session.finished` (with the outcome)                                                                                                                                                                                                                                                                                                                                                                                      |
| `SessionOutcome` | `subtype` (`success` or the driver's error subtype, e.g. `error_max_turns`, `error_driver`), session id, the report or `null`, the final text, usage, errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `HumanChannel`   | `permit(tool request)` and `ask(question, options, recommended, context, document)`, each with an optional `onNote` that takes the person's [note](./messaging.md#decisions) before the answer resolves; in a run it is the decision queue, where the terminal ([CLI](./cli/running-and-runs.md#questions-and-permissions-on-the-terminal)) races `ork decide` ([messaging](./messaging.md))                                                                                                                                                                                                                                                                                                                        |

**Holding a session** ([hold.ts](../packages/runtime/src/hold.ts),
[tests](../packages/runtime/test/hold.test.ts), ADR-041): with a `HoldPort`, the
adapter's hook (`claude`'s `PreToolUse` HTTP hook to the endpoint's `/hold`)
waits while the node is paused; past the 9-minute window it defers the call, and
the runner resumes the session once the node continues, yielding one session. A
message to a tool with no stdin waits for the turn's end, and the runner resumes
the session with it ([tests](../packages/runtime/test/session-runner.test.ts)).

## The drivers

A driver is an id of `DRIVER_IDS`
([drivers.ts](../packages/integrations/src/drivers.ts)) with an adapter of
strategies run by one session runner ([architecture](./architecture.md),
[registry.ts](../packages/runtime/src/registry.ts)), keyed by the id so a
missing entry does not compile. `claude-code` runs the user's own `claude`. Each
descriptor has `capabilities` (`questions`, `permissionPrompt`, `price`,
`midTurnMessages`, `reportSchema`, `turnLimit`, `mcpServers`; false: Ork
supplies a fallback or refuses the node) and `proven`. `open-code` runs the
user's own `opencode` ([its page](./runtime/open-code.md)); `command-code` runs
`cmd` ([its page](./architecture/command-code.md)). Both are `proven: false`:
`ork doctor` shows them as unproven `skip`. The ids `sdk` and `cli` are retired:
naming one is refused ("use `claude-code`"); a stored run's are read as
`claude-code` ([rows.ts](../packages/core/src/store/rows.ts)), never rewritten.

| Concern               | `claude-code` ([claude-code.ts](../packages/runtime/src/adapters/claude-code.ts))                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process               | the user's own `claude -p --input-format stream-json --output-format stream-json --verbose`                                                                         |
| Credentials           | `claude`'s own login, or `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1`; Ork never reads them, and `ork doctor` says which it found       |
| Brief and later input | stream-json lines on stdin; the first result ends stdin                                                                                                             |
| System prompt         | `--append-system-prompt`, `--exclude-dynamic-system-prompt-sections`                                                                                                |
| Report                | `--json-schema`                                                                                                                                                     |
| Ork's tools           | Ork's local MCP server, passed with `--mcp-config`; `--strict-mcp-config` unless `machineClaude`                                                                    |
| Permission prompts    | `--permission-prompt-tool mcp__ork__permission` → `HumanChannel.permit`                                                                                             |
| Tool rules            | `--allowedTools` (+ Ork's preapproved tools), `--disallowedTools`                                                                                                   |
| Model and effort      | `--model`, `--effort`                                                                                                                                               |
| Ork's skills          | `--plugin-dir`                                                                                                                                                      |
| Extra settings        | `--settings <json>`                                                                                                                                                 |
| Limits and resume     | `--max-turns`, `--max-budget-usd`, `--resume`                                                                                                                       |
| A leader's cache      | `ENABLE_PROMPT_CACHING_1H=1` in the `claude` process's environment                                                                                                  |
| Auto-memory           | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the `claude` process's environment unless `machineClaude`                                                                    |
| A failure to start    | a `session.finished` event with `subtype: "error_driver"` and the last stderr block (banner and stack dropped, capped, masked); `interrupted` on a signal or a stop |

## Which driver a session uses

One rule, for every caller ([driver.ts](../packages/core/src/run/driver.ts)):
`--driver`, else the node's `driver` (or its agent's), else the workflow's
`defaults.driver` (the project's `.ork/project.yaml` default included), else the
driver ready on the machine running it. A workflow is committed, so nothing
writes one person's driver into it; `ork init`'s starter names none.

- **The one ready** is what `ork doctor`'s own checks find
  ([ready.ts](../packages/integrations/src/ready.ts)): `claude-code` is ready
  when `claude` is installed and logged in, or `ANTHROPIC_API_KEY` or
  `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1` is set. With more than one
  ready, a run takes `claude-code`.
- **`ork run` looks once, before anything starts**, and only when a session node
  names no driver and `--driver` isn't given
  ([ready-driver.ts](../packages/cli/src/run/ready-driver.ts)). It says so in
  one line on stderr:
  `No driver is named, so the run uses the claude-code driver: the one ready here (…).`,
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

Every Claude session of a run (workers, leaders, a leader's question fork)
starts **clean of the machine's Claude setup**
([claude-code.ts](../packages/runtime/src/adapters/claude-code.ts),
[tests](../packages/runtime/test/clean.test.ts), ADR-065):

- **The repository's setup loads**: `settingSources` stays `project`, `local`,
  so `CLAUDE.md`, `AGENTS.md` and `.claude/`'s agents, skills and settings load,
  with Ork's own plugins and context. User-level `~/.claude` settings never do.
- **No MCP server but Ork's**: `--strict-mcp-config`, so neither
  `~/.claude.json`'s servers, nor those registered for the folder, nor a
  project's `.mcp.json` or plugins' servers load. Their set changing mid-session
  rewrote the prompt cache: the same 4-turn task on `claude` 2.1.319 cost $0.113
  loose and $0.032 strict. The servers a node names load too (below).
- **No auto-memory**: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the session's
  environment, so the machine user's notes under
  `~/.claude/projects/<folder>/memory/` stay out.
- **The per-machine prompt sections leave the cached prefix**:
  `--exclude-dynamic-system-prompt-sections` moves the working directory, memory
  path and git status into the first user message. It changes no content, so it
  stays on either way.

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
[tests](../packages/runtime/test/mcp-servers.test.ts)). `SessionSpec`'s
`mcpServers` holds those entries of the project's `.mcp.json`, as written, and
the driver adds them beside Ork's in `--mcp-config`. Strict stays on, so nothing
else loads. Naming a server adds `mcp__<name>` to the node's allow list (deny
rules win). `${VAR}` stays text: `claude` expands it. The sessions the CLI
starts itself (`ork run --node`, `ork chat`) load them too. A leader's question
fork loads none.

## Ork's MCP server

[mcp-http.ts](../packages/runtime/src/mcp-http.ts) serves one session:

- on `127.0.0.1` only, on a random port, behind a per-session bearer token
  compared in constant time;
- MCP's streamable HTTP transport with plain JSON replies (no SSE stream):
  `initialize`, `ping`, `tools/list`, `tools/call`; notifications get `202`;
  `GET` and other methods get `405`; bodies over 1 MiB get `413`;
- tools: what the registry binds for the session ([messaging](./messaging.md)):
  `ask_user`, `permission` (the CLI's permission-prompt contract, answering
  `{"behavior":"allow"|"deny", …}`), for leaders `delegate` and `spawn_worker`,
  and `report` on a driver without `reportSchema`
  ([node report](./runtime/node-report.md)); a tool's arguments may depend on
  its session; they are validated with Zod, and a failure is an error result
  naming the field ([delegation](./scheduler.md#delegation));
- a per-server `timeout` of 24 hours in `--mcp-config`: the CLI otherwise ends
  an HTTP request after 60 seconds and drops a call silent for 5 minutes, and
  `delegate` waits for whole child sessions. `MCP_TOOL_TIMEOUT` (about 28 hours
  by default) still caps it.

## Usage accounting

The outcome's usage comes from the final `result` message: cost (a client-side
estimate), input, output, cache-read and cache-write tokens, turns and duration.
In streaming mode a later result carries running totals; read the latest, never
sum. The same holds across a resume: a resumed session's cost is the session's
total so far, when its transcript saved one, while its tokens, turns and
duration are that process's own; a crash's result may carry zero
([usage](./usage.md#what-a-resumed-session-spent)).

## Limits

What the driver does for now, by choice. The gaps review carried a threshold for
L171 to the cost benchmark ([register](./gaps.md#limits)).

- **L171 · A Claude report's fields are not cut.** A tool's output over 64 KiB
  is cut, and the whole kept in a run file it names by path
  ([scheduler](./scheduler.md#built-in-node-types)). A Claude report's `summary`
  and `output.schema` fields pass through whole, however long, into the run's
  record and any prompt that reads them. A report names big outputs as files
  under `artifacts`, by path. ([context](./context.md))

## Contents

- [The node report](./runtime/node-report.md)
- [The `open-code` driver](./runtime/open-code.md)
