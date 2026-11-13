# Runtime: the agent drivers

Status: **Built**: the port, the adapter strategies and session runner, the
`claude-code` driver and Ork's MCP tools, tested against a stand-in `claude`;
the [`open-code`](./runtime/open-code.md) and
[`command-code`](./architecture/command-code.md) drivers are built and proven on
a real session ([code](../packages/runtime/src/index.ts),
[tests](../packages/runtime/test/runtime.test.ts)), and run one node at a time
by [`ork run --node`](./cli/running-and-runs.md#running-one-node). Why:
[ADR-004](../decisions/ADR-004-no-credentials.md),
[ADR-005](../decisions/ADR-005-one-runtime-port-two-drivers.md),
[ADR-010](../decisions/ADR-010-reports-as-structured-output.md),
[ADR-011](../decisions/ADR-011-in-house-mcp-server.md),
[ADR-065](../decisions/ADR-065-clean-claude-sessions.md), and
[RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md) (no SDK driver).

## The port

`@krapht/ork-core` defines the port
([runtime/types.ts](../packages/core/src/runtime/types.ts));
`@krapht/ork-runtime` implements it; tests implement it with a fake.

| Type             | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentRuntime`   | `{ driver: "claude-code" \| "open-code" \| "command-code"; start(spec, ports): Session }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SessionPorts`   | what the session reaches besides its spec: the `HumanChannel`, for a leader in a run its `Ownership` (children, worker templates, `delegate`, `spawn`; [scheduler](./scheduler.md#delegation)), for a leader or worker in a run its `Mailbox` on the [message bus](./messaging.md#message-bus), and in a run its `HoldPort` ([run control](./run-control.md#pause)) and its `MachinePort` (priority, slots for heavy Bash calls; [machine](./machine.md))                                                                                                                                                                                                                                                                       |
| `SessionSpec`    | node id, `cwd`, `model`, `effort`, Ork's `plugins` and extra `settings` ([context](./context.md#how-a-nodes-session-is-compiled)), the rendered brief (`prompt`), `systemAppend`, `settingSources` (`project`, `local`; never `user`), tool rules (`allow`, `deny`, `only`: the only built-in tools, `strictMcp`: no MCP server but Ork's, `--strict-mcp-config`), permission mode, `maxTurns`, `budgetUsd`, the report schema, `resume`, `fork` (with `resume`, a copy of that session: `--fork-session`; [leader questions](./messaging/leader-questions.md)), `promptCache` (`1h` for a leader), `machineClaude` (load the machine's MCP servers and auto-memory; [what a session loads](./runtime/what-a-session-loads.md)) |
| `Session`        | `events` (an async iterable of `RuntimeEvent`), `send(text)` (a user message with `priority: "next"`: Claude Code shows it at the session's next step, mid-turn or not), `interrupt()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RuntimeEvent`   | `session.started` (with the session's `cwd` and `driver`, so `ork chat` can resume it), `session.waiting` (with a `reason`: the session waits before its tool starts, e.g. for its checkout on `command-code`; nothing derives from it), `assistant.text`, `tool.called`, `tool.result` (with the CPU it used, for an Ork tool command), `session.finished` (with the outcome)                                                                                                                                                                                                                                                                                                                                                  |
| `SessionOutcome` | `end` (how the session ended: one closed kind, Ork's message and the scrubbed detail; [how a session ends](./runtime/session-ends.md)), `subtype` (`success` or the driver's error subtype, kept one release for stored events), session id, the report or `null`, the final text, usage, errors                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `HumanChannel`   | `permit(tool request)` and `ask(question, options, recommended, context, document)`, each with an optional `onNote` that takes the person's [note](./messaging.md#decisions) before the answer resolves; in a run it is the decision queue, where the terminal ([CLI](./cli/running-and-runs.md#questions-and-permissions-on-the-terminal)) races `ork decide` ([messaging](./messaging.md))                                                                                                                                                                                                                                                                                                                                    |

**Holding a session** ([hold.ts](../packages/runtime/src/hold.ts),
[tests](../packages/runtime/test/hold.test.ts), ADR-041): with a `HoldPort`, the
adapter's hook (`claude`'s `PreToolUse` HTTP hook to the endpoint's `/hold`)
waits while the node is paused; past the 9-minute window it defers the call, and
the runner resumes the session once the node continues, yielding one session. A
message to a tool with no stdin waits for the turn's end, and the runner resumes
the session with it ([tests](../packages/runtime/test/session-runner.test.ts)).
The same hook takes a slot for a Bash call matching `heavy`, and a `PostToolUse`
hook on Bash frees it ([machine](./machine.md#a-sessions-bash-call)).

## The drivers

A driver is an id of `DRIVER_IDS`
([drivers.ts](../packages/integrations/src/drivers.ts)) with an adapter of
strategies run by one session runner ([architecture](./architecture.md),
[registry.ts](../packages/runtime/src/registry.ts)), keyed by the id so a
missing entry does not compile. `claude-code` runs the user's own `claude`. Each
descriptor has `capabilities` (`questions`, `permissionPrompt`, `price`,
`midTurnMessages`, `reportSchema`, `turnLimit`, `mcpServers`, `subagents`;
false: Ork supplies a fallback or refuses the node) and `proven`. `open-code`
runs the user's own `opencode` ([its page](./runtime/open-code.md));
`command-code` runs `cmd` ([its page](./architecture/command-code.md)). Both are
`proven: true`, since their gate runs (2026-11-10); a descriptor with
`proven: false` is refused and never counts as ready. The session runner sets
`PWD` to the session's folder, which OpenCode reads as its own. The ids `sdk`
and `cli` are retired: naming one is refused ("use `claude-code`"); a stored
run's are read as `claude-code` ([rows.ts](../packages/core/src/store/rows.ts)),
never rewritten.

| Concern               | `claude-code` ([claude-code.ts](../packages/runtime/src/adapters/claude-code.ts))                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process               | the user's own `claude -p --input-format stream-json --output-format stream-json --verbose`                                                                                                                                                                                 |
| Credentials           | `claude`'s own login, or `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1`; Ork never reads them, and `ork doctor` says which it found                                                                                                               |
| Brief and later input | stream-json lines on stdin; the first result ends stdin                                                                                                                                                                                                                     |
| System prompt         | `--append-system-prompt`, `--exclude-dynamic-system-prompt-sections`                                                                                                                                                                                                        |
| Report                | `--json-schema`                                                                                                                                                                                                                                                             |
| Ork's tools           | Ork's local MCP server, passed with `--mcp-config <file>`; `--strict-mcp-config` unless `machineClaude`                                                                                                                                                                     |
| Permission prompts    | `--permission-prompt-tool mcp__ork__permission` → `HumanChannel.permit`                                                                                                                                                                                                     |
| Tool rules            | `--allowedTools` (+ Ork's preapproved tools), `--disallowedTools`                                                                                                                                                                                                           |
| Model and effort      | `--model`, `--effort`                                                                                                                                                                                                                                                       |
| Ork's skills          | `--plugin-dir`                                                                                                                                                                                                                                                              |
| Extra settings        | `--settings <file>`                                                                                                                                                                                                                                                         |
| Limits and resume     | `--max-turns`, `--max-budget-usd`, `--resume`; `budgetTokens` is Ork's own ([session ends](./runtime/session-ends.md#the-token-cap))                                                                                                                                        |
| A leader's cache      | `ENABLE_PROMPT_CACHING_1H=1` in the `claude` process's environment                                                                                                                                                                                                          |
| Auto-memory           | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the `claude` process's environment unless `machineClaude`                                                                                                                                                                            |
| Bash calls            | `BASH_DEFAULT_TIMEOUT_MS=600000` in the `claude` process's environment: a command runs up to ten minutes in front, not moved to the background at two                                                                                                                       |
| A failure to start    | a `session.finished` event with `subtype: "error_driver"`, an `end` (`tool_missing` when the program is not installed, `driver_crashed` otherwise) and the last stderr block as its scrubbed detail (banner and stack dropped, capped); `interrupted` on a signal or a stop |

## Which driver a session uses

One rule, for every caller ([driver.ts](../packages/core/src/run/driver.ts)):
the driver the node's `model` names (`claude-code.opus`), else `--driver`, else
the node's `driver` (or its agent's), else `defaults.driver`, else the driver
ready on the machine running it. The rule, the model prefix and the ready driver
are in [which driver a session uses](./runtime/which-driver.md).

## What a session loads

Every Claude session of a run starts clean of the machine's Claude setup: the
repository's setup loads, no MCP server but Ork's (and the ones a node names),
no auto-memory. `ork run --machine-claude` turns the machine's back on. The
rules are in [what a session loads](./runtime/what-a-session-loads.md).

## Ork's MCP server

[mcp-http.ts](../packages/runtime/src/mcp-http.ts) serves one session:

- on `127.0.0.1` only, on a random port, behind a per-session bearer token
  compared in constant time;
- MCP's streamable HTTP transport with plain JSON replies (no SSE stream):
  `initialize`, `ping`, `tools/list`, `tools/call`; notifications get `202`;
  `GET` and other methods get `405`; bodies over 1 MiB get `413`;
- tools: what the registry binds for the session ([messaging](./messaging.md)):
  `ask_user`, `permission` (the CLI's permission-prompt contract, answering
  `{"behavior":"allow"|"deny", …}`), for leaders `delegate` and `spawn_worker`
  (each task takes an optional `description`, a few words that label the child;
  [delegation](./scheduler.md#delegation)), and `report` on a driver without
  `reportSchema` ([node report](./runtime/node-report.md)); a tool's arguments
  may depend on its session; they are validated with Zod, and a failure is an
  error result naming the field ([delegation](./scheduler.md#delegation));
- a per-server `timeout` of 24 hours in `--mcp-config`: the CLI otherwise ends
  an HTTP request after 60 seconds and drops a call silent for 5 minutes, and
  `delegate` waits for whole child sessions. `MCP_TOOL_TIMEOUT` (about 28 hours
  by default) still caps it.
- the token kept off the command line: `--mcp-config` (the bearer token) and
  `--settings` (the hold hook's token) name files in a private folder under the
  system's temporary folder (`ork-sessions/<pid>-…`, 0700, each file 0600),
  removed when the session ends, as OpenCode's config is
  ([its page](./runtime/open-code.md#the-config-file)). A process's arguments
  can be read by other users of the machine; the root folder must be the user's
  own, not a link, or the session refuses to start.

## Usage accounting

The outcome's usage comes from the final `result` message: cost (a client-side
estimate), input, output, cache-read and cache-write tokens, turns and duration.
In streaming mode a later result carries running totals; read the latest, never
sum. The same holds across a resume: a resumed session's cost is the session's
total so far, when its transcript saved one, while its tokens, turns and
duration are that process's own; a crash's result may carry zero
([usage](./usage.md#what-a-resumed-session-spent)).

## How a session is spawned

([session-leg.ts](../packages/runtime/src/session-leg.ts),
[leg-spawn.ts](../packages/runtime/src/leg-spawn.ts),
[ADR-087](../decisions/ADR-087-node-processes-end-with-ork.md)) On POSIX a
session leg runs in its own process group, `detached`, beside a small `sh`
watcher that holds a pipe from `ork`
([orphan-guard.ts](../packages/core/src/machine/orphan-guard.ts)). The command
is `sh -c '<watch> & exec "$0" "$@"'`, so the driver's pid, and the SIGINT that
`interrupt()` and a stop send it, stay the driver's own. If `ork` dies by any
cause, including SIGKILL, the pipe reads EOF, and the watcher sends the group
SIGTERM, then SIGKILL after 2 seconds, so a session never outlives the lock or
slot its run held. When the session ends normally the watcher is stopped first.
A program not found on `PATH` is spawned bare, so a missing driver fails as
before.

- **Ctrl-C, Ctrl-Z.** `ork`'s SIGINT handler stops the run's sessions; Ctrl-Z no
  longer pauses them ([L323](./gaps/machine-limits.md)).
- **Windows.** There is no `sh` and no POSIX group; the session is spawned as
  before and may outlive a killed `ork` ([L319](./gaps/machine-limits.md)).

## Limits

What the driver does for now, by choice. L171's threshold waits on the cost
benchmark ([register](./gaps.md#limits)).

- **L171 · A Claude report's fields are not cut.** A tool's output over 64 KiB
  is cut, and the whole kept in a run file it names by path
  ([scheduler](./scheduler.md#built-in-node-types)). A Claude report's `summary`
  and `output.schema` fields pass through whole, however long, into the run's
  record and any prompt that reads them. A report names big outputs as files
  under `artifacts`, by path. ([context](./context.md))

## Contents

- [The node report](./runtime/node-report.md)
- [How a session ends](./runtime/session-ends.md)
- [Which driver a session uses](./runtime/which-driver.md)
- [What a session loads](./runtime/what-a-session-loads.md)
- [The `open-code` driver](./runtime/open-code.md)
