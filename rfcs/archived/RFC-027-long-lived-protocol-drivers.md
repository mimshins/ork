# RFC-027 — A two-way client for `omp --mode rpc` and `codex app-server`

- **Status:** Implemented
- **Date:** 2026-11-20
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context): what the runner can do today, what two drivers lack, what
  the two protocols offer, what step 13 measured
- [Options](#options): A a shared two-way client, B a client in each adapter, C
  one process a leg, D the Agent Client Protocol
- [Decision](#decision): the maintainer's two decisions, accepted 2026-11-20
- [Consequences](#consequences)
- [Open questions](#open-questions)
- [Spike, step 13, 2026-11-20](#spike-step-13-2026-11-20): what the paid RPC
  turns showed

## Context

Two drivers run one process a leg and are left with the same limits.
[ADR-102](../../decisions/ADR-102-codex-driver.md) (`codex`) and
[ADR-105](../../decisions/ADR-105-omp-driver.md) (`omp`) both chose one
`exec`-style process per leg, with `midTurnMessages: false` and
`permissionPrompt: false` in
[cli-drivers.ts](../../packages/integrations/src/cli-drivers.ts), so a message
waits for the leg's end and a call that would ask is refused. The register holds
them as G39 and G45 ([gaps](../../specs/gaps.md#gaps)). Each ADR left the
long-lived shape to a later RFC, and RFC-026 decided it would be one RFC for
both tools ([RFC-026](../archived/RFC-026-omp-driver.md), option 1D; follow-up
09c7f59c). RFC-024 had left `codex app-server` for when it stopped being
experimental ([RFC-024](../archived/RFC-024-codex-driver.md), option 1C).

**What the runner can do today.**
[adapter.ts](../../packages/runtime/src/adapter.ts) gives a `Command` an
optional `input` that turns a message into one line for the process's stdin.
[session-runner.ts](../../packages/runtime/src/session-runner.ts) writes the
brief and later messages through it, and `LegInput.attach` hands the runner a
`{ write, stop }` pair
([session-leg.ts](../../packages/runtime/src/session-leg.ts)). That is a one-way
pipe: nothing is sent that waits for a reply, and nothing the tool sends can ask
Ork a question. `claude-code` is the long-lived driver and gets by without more:
its approvals are a tool the CLI calls on Ork's own MCP endpoint
(`--permission-prompt-tool`,
[permission.ts](../../packages/runtime/src/tools/permission.ts), available only
to `claude-code`), and its interrupt is a signal.

The runner already owns what a long-lived driver would otherwise rewrite:
pausing and holding a call
([ADR-041](../../decisions/ADR-041-pause-continue-stop.md)), `heavy` slots, the
token budget, the `report` tool, the orphan guard that ends a process with Ork
([leg-spawn.ts](../../packages/runtime/src/leg-spawn.ts),
[ADR-087](../../decisions/ADR-087-node-processes-end-with-ork.md)), and how a
session ends.

**What the two protocols offer.**

- `omp --mode rpc` speaks newline-delimited JSON over stdio, not JSON-RPC
  ([RFC-026](../archived/RFC-026-omp-driver.md) quotes the documents; they do
  not mark it experimental). A command carries an `id` and is answered by a
  `{"type":"response"}` frame with the same id. Commands used here: `prompt`,
  `steer`, `follow_up`, `abort`, `get_state`, `set_host_tools`. Frames the tool
  sends first: `ready`, then events, `extension_ui_request` (a question for the
  host), `host_tool_call`, `prompt_result` and `session_settled`.
- `codex app-server` speaks JSON-RPC 2.0 over stdio and is marked
  `[experimental]` in codex-cli 0.169.0
  ([RFC-024](../archived/RFC-024-codex-driver.md)). Not run for this RFC.
  `codex app-server generate-json-schema` (no model call) lists, by method name:
  client requests `initialize`, `thread/start`, `thread/resume`, `thread/fork`,
  `turn/start`, `turn/steer`, `turn/interrupt` among 109; server requests (the
  tool asks the host, which answers by id)
  `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
  `item/permissions/requestApproval`, `item/tool/call`,
  `item/tool/requestUserInput`, `mcpServer/elicitation/request` among 10; 86
  notifications including `turn/completed` and `thread/tokenUsage/updated`.

The two differ in framing, handshake and how a turn ends, and agree on what Ork
wants of a session: send a message while a turn runs, interrupt it, answer a
question the tool asks, and serve a tool call the tool makes.

**What step 13 measured.** The maintainer approved one paid RPC turn of `omp` on
2026-11-20. Nine short capped turns on `anthropic/claude-haiku-4-5` ran, about
$0.09 by `omp`'s own `cost.total` fields; the whole record is under
[Spike, step 13](#spike-step-13-2026-11-20). In short:

1. A `steer` sent while a `bash` call runs is queued; the model sees it only
   after the call returns. Only `abort` ends a running call, at once, and the
   turn with it.
2. An approval is an `extension_ui_request` of method `select` whose title is
   rendered text and whose options are labels; the call's arguments are not in
   it. Ork's own settings overlay (`approvalMode: always-ask` with a per-tool
   map) makes every tool in the map decided up front, so only a tool missing
   from the map reaches the host.
3. `set_host_tools` works. With `tools.xdev: false`, as Ork sets it, the host
   tool is a first-class tool, needs an entry in the approval map, and a
   `host_tool_call` frame carries its arguments with no token, file or port.
4. `ready` came 10.4 to 12.4 seconds after spawn in eight runs and 25.0 seconds
   in one, so a process that serves several turns pays that once.

## Options

### Option A — one two-way client in the runner, one codec per driver

The runner gets a duplex strategy beside `command.input`. It owns the pipe, a
table of requests Ork sent and is waiting on, and a handler for requests the
tool sends. A codec per driver (`omp-rpc`, later `codex-app-server`) turns
frames into `RuntimeEvent`s, a message into a steer, an interrupt into a frame
and a decision into an answer. A sketch, names not decided:

```ts
type Codec = {
  open: (spec: SessionSpec, leg: LegContext) => Frame[]; // handshake, tools, first prompt
  decode: (frame: Frame) => Decoded & { ask?: Ask }; // events, or a request for Ork to answer
  message: (text: string) => Frame; // steer
  interrupt: () => Frame; // abort, turn/interrupt
  answer: (ask: Ask, decision: Decision) => Frame;
};
```

- **Pros:** pause, stop, hold, `heavy`, the budget, the `report` tool and the
  orphan guard stay written once in the runner; a driver is a codec, as the
  strategies in `adapter.ts` make it today. The client is designed against two
  real protocols, whose four shared needs are the ones above. An approval goes
  straight to `ports.human.permit`, the call `permission.ts` makes, with no MCP
  detour. A process serves several turns, so the 10 to 12 seconds to `ready` is
  paid once. Closes G45 and, with the codex codec, G39.
- **Cons:** a runner path that is not a process per leg, with its own end,
  restart and resume rules; a new strategy in `adapter.ts` for every later
  reader to keep true. The codex codec rests on an experimental protocol Ork
  does not control, and the shape of the client is checked against only one
  protocol that was run.

### Option B — each adapter owns its client

The runner gains a slot that lets an adapter run the whole session itself;
`omp-rpc.ts` holds its own request table and writer, and codex copies the idea.

- **Pros:** nothing is designed for a driver not yet built or run; the runner's
  contract does not change until something needs it.
- **Cons:** the second client solves the same problems again: ids and replies,
  answering a request from the tool, an interrupt that is a frame, finding a
  process again after Ork restarts. Pause, stop, hold, `heavy` and the budget
  are wired once per adapter and can drift apart, which is what one runner for
  every driver was built to prevent
  ([adapter.ts](../../packages/runtime/src/adapter.ts)).

### Option C — keep one process a leg; record the measurements

No client. G39 and G45 stay open and the spike's measurements go into the gaps.

- **Pros:** no new runner path and nothing to keep true for an experimental
  protocol; the per-leg drivers are built and, for `codex`, proven.
- **Cons:** no message that reaches the model before a leg ends, no approval Ork
  can answer (a call that would ask is refused), no interrupt frame, no tool
  served over the pipe, on both drivers with no date to revisit, and a process
  start-up on every leg.

### Option D — the Agent Client Protocol as the one wire

`omp acp`, `opencode acp` and `cmd acp` speak it
([RFC-014](../archived/RFC-014-cli-drivers-only.md),
[RFC-026](../archived/RFC-026-omp-driver.md) option 1C), so one client could
serve three drivers.

- **Pros:** one protocol for three of Ork's tools; permission requests are part
  of it (`session/request_permission`).
- **Cons:** `codex` does not speak it, so half the brief is not served. Its
  usage, resume and per-session approval fields were not read for Ork, and
  RFC-026 records that `omp`'s ACP server takes its settings from the process's
  flags and has no per-session approval field.

## Decision

**Option A.** The session runner gets one two-way client and each driver
supplies its codec (the maintainer, 2026-11-20). It is built for what a
long-lived session needs that the one-way pipe lacks: a message while a turn
runs, an interrupt that is a frame, a question from the tool that Ork answers,
and a tool call the tool makes that Ork serves.

**The first build covers `omp` only, and Ork's tools stay on MCP** (the
maintainer, 2026-11-20). The client and the `omp-rpc` codec ship with `steer`,
`abort` and approvals Ork answers. Ork's tools keep reaching `omp` through
RFC-026's plugin and MCP endpoint, so the token handling does not change. Host
tools and the `codex-app-server` codec are later changes of their own; this RFC
does not wait for `codex app-server` to leave experimental and does not set when
its codec is built.

## Consequences

- **Code:** a `protocol` strategy in `adapter.ts`, a duplex path in
  `session-runner.ts` and `session-leg.ts`, an `omp-rpc` codec beside the other
  `omp-*.ts` files. `omp`'s descriptor flips `midTurnMessages` and
  `permissionPrompt` to `true` and its `permissions.kind` becomes `callback`; an
  approval calls `ports.human.permit` from the client, not the MCP `permission`
  tool, which stays `claude-code`'s.
- **A session ends at `session_settled`, not at `prompt_result`.** In the
  default-settings steer run `prompt_result` said `completed` with
  `sessionSettled: false` and the session woke again 16 seconds later. Ork's
  overlay turns that off (`async.enabled: false`, `bash.autoBackground`), but
  the codec must treat `session_settled` as the end.
- **`midTurnMessages: true` means before the turn ends, not at once.** A message
  reaches the model after the running tool call; `abort` is the interrupt. The
  `omp` spec and the capability's comment in `drivers.ts` say so.
- **`--no-ui` and approvals.** With `--no-ui`, a tool missing from the approval
  map fails closed before Ork sees it; without it, the codec must answer or
  ignore `extension_ui_request` frames of other methods (`setWidget` arrived
  from a user extension on every run without `--no-ui`). The first build drops
  `--no-ui` where Ork answers approvals, on purpose.
- **An approval is answered from text.** The reply is the option label
  (`Approve`, `Deny`); Ork never sends `Approve write for this session`, since
  Ork decides each call. The call's arguments come from the
  `tool_execution_start` frame that precedes the request.
- **Specs and records:** [runtime/omp.md](../../specs/runtime/omp.md) and its
  chunks, the runtime port's capabilities, G45 (closed by the build, with G46
  re-read, see below), G39 (still open until the codex codec), the interaction
  map and the roadmap; an ADR when it ships, and `pnpm rfc:close RFC-027`. A
  gate run on a real session proves the `omp` descriptor again, as RFC-024 and
  RFC-026 did.
- **User docs:** [the omp guide](../../docs/guides/drivers/omp.md) and a bullet
  in [Next release](../../docs/whats-new/next-release.md) when the build lands,
  as a message to an `omp` node now arrives mid-turn.
- **Cost:** a new runner path and a new strategy to keep true; a pending request
  table that must be failed on exit and on interrupt.
- **Built in two steps (2026-11-21 note).** The first build covered `omp`
  ([ADR-108](../../decisions/ADR-108-duplex-session-client.md)); the second
  added the `codex app-server` codec as the `codex-app-server` driver
  ([ADR-115](../../decisions/ADR-115-codex-app-server-driver.md)), beside the
  unchanged `codex`, with two optional parts on the codec (`readyAtSpawn`,
  `waitsForTurn`) that `omp` does not use. G39 closes with it. Host tools stay a
  later change on both codecs, so the RFC is fully built without them.

## Open questions

Unknowns for the build and its gate run; none changes the decision.

1. **Resume after Ork restarts.** The spike used `--no-session`. Whether
   `omp --mode rpc --resume <id>` with Ork's `--session-dir` continues a session
   `ork resume` and `ork chat` find again was not measured; `get_state` returns
   the session id and file.
2. **Linking a request to its call.** The `select` request has its own `id` and
   no `toolCallId`; the `tool_execution_start` before it has one. No field
   joining them was seen, so the codec pairs them by order.
3. **G46, a long pause.** A process that lives across turns might hold a call as
   long as Ork keeps it, and so close G46. Not measured; the guard's handler
   timeout (`extensionHandlers.toolCallTimeoutMs`) still bounds a wait.
4. **Frame size and volume.** `ready` reports `maxFrameBytes` of 1048576 and
   chunked frames above it; the codec must reassemble them or pin the protocol.
   One host-tool run printed 166 `message_update` frames; whether
   `set_event_filter` drops them without losing usage was not measured.
5. **Protocol version.** `ready` says `protocolVersion: 1` with `[1, 2]`
   supported; the effect of asking for 2 was not measured.
6. **Cost cap over several prompts.** `--max-cost` is documented to end a prompt
   with `error.code: "cost_cap"`; it was not provoked, and whether the cap spans
   prompts of one process or restarts at each was not measured.
7. **Start-up.** The spike ran with the user's own extensions, so the 10 to 12
   seconds to `ready` includes whatever they load; Ork's flags may differ.
8. **Host tools, later.** `host_tool_cancel`, a call's timeout and the
   `loadMode` field of `set_host_tools` were not measured, nor how `ask_user`
   and `report` would change when served as host tools. _Built 2026-11-21
   ([ADR-113](../../decisions/ADR-113-omp-host-tools.md)): Ork's tools reach
   `omp` as host tools, on the fake `omp`; the unknowns are
   [L534 to L537](../../specs/gaps/omp-limits.md), for the gate run to measure.
   The RFC stays Active: the Codex codec and the other questions remain._
9. **Codex.** The codec's needs come from method names only. `turn/steer` while
   a command runs may wait for the command as `omp`'s does; the handshake,
   `thread/resume`, approvals, `item/tool/call` and `thread/tokenUsage/updated`
   were not run. The protocol is experimental. **Outcome (2026-11-21):** the
   codec shipped as a new driver id, `codex-app-server`, unproven
   ([ADR-115](../../decisions/ADR-115-codex-app-server-driver.md)), with its
   shapes read from `codex app-server generate-json-schema` of codex-cli 0.169.0
   and no paid spike first (the maintainer's call); every shape a run alone can
   measure, the steer's wait for a running command included, is a recorded limit
   ([L548 to L559](../../specs/gaps/codex-app-server-limits.md)).

## Spike, step 13, 2026-11-20

On the maintainer's go, in a scratch git repository, with `omp` 18.22.2 and
`anthropic/claude-haiku-4-5`, each run capped by `--max-cost 0.30`. A small Node
script (not committed) spawned `omp --mode rpc` with
`--no-session --no-skills --no-rules --no-title --no-lsp --no-pty --no-prewalk --no-judge --no-spotlight --offline`,
sent the frames below, and logged every frame. "Ork's overlay" runs add
`--config` with the settings of
[omp-config.ts](../../packages/runtime/src/adapters/omp-config.ts)
(`tools.xdev: false`, `approvalMode: always-ask`, `async.enabled: false`,
`bash.autoBackground.enabled: false`, and an approval map allowing `read`,
`edit`, `bash`, `grep` and `glob`) and `--tools read,edit,write,bash,grep,glob`.
The overlay was typed by hand from that file, without `disabledProviders` and
the handler timeout, not generated by the driver. `codex app-server` was not
run; only its schema was generated.

1. **`steer` during `bash`, default settings.** Prompt: run `sleep 20`, then
   answer `done`. Three seconds into the call, `{"type":"steer","message":…}`.
   The tool answered `queue_update` and
   `{"type":"response","command":"steer", "success":true}`, then ended the call
   early with "Backgrounded early to handle an incoming message; the command
   keeps running", took the steer into the next turn, and said `prompt_result`
   `completed` with `sessionSettled: false`. About 16 seconds later the finished
   job woke the session (`async-result`), a third model turn ran, and
   `session_settled` came. Three assistant messages cost about $0.021 in all.
2. **`steer` during `bash`, Ork's overlay.** The same prompt. The steer was
   queued (`queue_update` listing it), the call ran its full 20.11 seconds, and
   the model saw the steer only then; `prompt_result` `completed` with
   `sessionSettled: true` came right before `session_settled`.
3. **`abort` during `bash`.** `{"id":"a1","type":"abort"}` three seconds in. The
   call ended at once with `Command aborted` and `isError: true`; the answers
   were `{"command":"abort","success":true}`, `prompt_result` with
   `status: "aborted"` and `sessionSettled: true`, then `session_settled`;
   `get_state` answered; the process exited 0 about 1.6 seconds after stdin
   closed. About $0.002. After this run and the first steer run, `pgrep -x omp`
   and `pgrep -x sleep` found nothing.
4. **An approval, no `--no-ui`, `--approval-mode always-ask`, default
   settings.** Prompt: create `a.txt` containing `x`. The tool sent
   `tool_execution_start` (`write`, `args` with the path and content), then
   `{"type":"extension_ui_request","id":…,"method":"select","title":"Allow tool: write\nPath: a.txt\nContent:\nx","options":["Approve","Approve write for this session","Deny"]}`.
   The reply `{"type":"extension_ui_response","id":…, "confirmed":true}` was a
   denial (`Tool call denied by user: write`); the reply `{…,"value":"Approve"}`
   wrote the file. A `setWidget` request with no options arrived on every run
   without `--no-ui`, from a user extension, and needed no answer.
5. **The same, Ork's overlay with no approval entry for `write`.** Identical
   frames; the request still reached the host, and `value: "Approve"` allowed
   it.
6. **Host tool, default settings.** `set_host_tools` with one tool `ork_ping`
   (`parameters` a JSON Schema) answered `{"toolNames":["ork_ping"]}`. The model
   called it by writing to `xd://ork_ping`; the tool sent
   `{"type":"host_tool_call", "id":…,"toolCallId":…,"toolName":"ork_ping","arguments":{"msg":"hi"}}`,
   and
   `{"type":"host_tool_result","id":…,"result":{"content":[{"type":"text", "text":"…"}]}}`
   completed it. About $0.022.
7. **Host tool, Ork's overlay, no approval entry for it, with `--no-ui`.** The
   tool ran as `ork_ping` (not through `xd://`) and failed with
   `Tool "ork_ping" requires approval but no interactive UI available`; the
   model then tried to edit settings and wrote nothing.
8. **Host tool, Ork's overlay, `ork_ping: allow` in the map.** `host_tool_call`
   arrived as in 6 with `toolName: "ork_ping"`; the result came back and the
   turn completed (`sessionSettled: true`).
9. **Start-up.** Time from spawn to `ready` in the nine runs, in order: 11.3,
   10.7, 10.4, 12.4, 25.0, 11.7, 10.9, 10.6 and 12.3 seconds.

Not run: a cost cap, `follow_up`, `fork`, `set_event_filter`, protocol 2, resume
with a session directory, a process killed by a signal, `codex app-server`.
