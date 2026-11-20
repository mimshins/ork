# The `codex-app-server` driver

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built and unproven**: the `codex-app-server` descriptor
(`proven: false`), the adapter
([codex-app-server.ts](../../packages/runtime/src/adapters/codex-app-server.ts)),
its codec ([codex-rpc.ts](../../packages/runtime/src/adapters/codex-rpc.ts)) and
the approvals, hook fence and usage it reads
([codex-app-server-events.ts](../../packages/runtime/src/adapters/codex-app-server-events.ts))
are built and tested on a fake `codex app-server`
([tests](../../packages/runtime/test/fake-codex-app-server.test.ts)) and on
recorded frames ([codec tests](../../packages/runtime/test/codex-rpc.test.ts)).
No model was called while it was built: every name comes from
`codex app-server generate-json-schema` of codex-cli 0.169.0, read as data, so
every shape is unmeasured ([limits](../gaps/codex-app-server-limits.md)). Until
a capped gate run passes, `ork validate` and `ork run` refuse the driver by name
and `ork doctor` shows it `skip`, as for `omp`
([drivers](./which-driver.md#the-ready-driver)).

Why: [ADR-115](../../decisions/ADR-115-codex-app-server-driver.md) (this
driver), [RFC-027](../../rfcs/archived/RFC-027-long-lived-protocol-drivers.md)
(the client it runs on),
[ADR-108](../../decisions/ADR-108-duplex-session-client.md) (the two-way
client), [ADR-102](../../decisions/ADR-102-codex-driver.md) (the `codex` driver
it sits beside), [ADR-004](../../decisions/ADR-004-no-credentials.md) (no
credentials).

## Beside `codex`

`codex-app-server` is a second driver id for the same tool, not a replacement:
[`codex`](./codex.md) runs `codex exec` per leg, is proven and is unchanged. A
node that wants a message to reach the model mid-turn, an interrupt that is a
real request, or approvals Ork answers names this one
(`driver: codex-app-server` or a model `codex-app-server.<model>`; the text
after the dot goes to Codex as `model` on the thread request). The two share the
sandbox choice, the MCP and hook wiring, the hook's canary and the refusal of a
user hooks file
([codex-shared.ts](../../packages/runtime/src/adapters/codex-shared.ts)); they
differ in how they reach the process.

## A session

One `codex app-server` process per leg, in the node's worktree, speaking
JSON-RPC 2.0 as one JSON object a line both ways through the
[two-way client](./duplex-client.md). The codec is `readyAtSpawn` (Codex sends
nothing first) and `waitsForTurn` (a steer names the running turn). The
envelopes carry no `jsonrpc` field. The session id Ork keeps is the thread id,
so `ork resume` and `ork chat` find it.

1. **Handshake**, chained through the codec: `initialize` (client info,
   `experimentalApi: false`: every method used is in the stable bundle); at its
   reply the `initialized` notification and the hook fence; then `thread/start`
   (a first leg, with the instructions as `developerInstructions`),
   `thread/resume` (a resumed leg) or `thread/fork` (a leader's question fork,
   whose reply names the fork's id); at the thread's reply `session.started` and
   `turn/start` with the prompt and the effort (on the turn, not the thread). An
   error reply to any step ends the leg failed, naming it.
2. **Message**: `turn/steer` with the running turn's id. A message sent before
   `turn/started` is held, since Codex refuses a steer with no turn. "Before the
   turn ends" is the promise, as on `omp`: whether it waits for a running
   command is unmeasured ([L552](../gaps/codex-app-server-limits.md)).
3. **Interrupt**: `turn/interrupt`; the session ends `interrupted` at the turn's
   `turn/completed` with status `interrupted`, with no report. A stop that Codex
   does not settle in time closes stdin and kills the process, as on `omp`.
4. **End**: `turn/completed` ends the session (Codex wakes nothing after it):
   `completed` is `finished` with its report from the `report` tool as on
   `codex`; `failed` carries `turn.error.message` through
   `classifyProviderError`, with the words of an `error` notification that Codex
   will not retry (one it will is a warning, dropped). The ends are `codex`'s,
   since the codec feeds
   [`codexDecoder`](../../packages/runtime/src/adapters/codex-events.ts) this
   leg's frames in `codex exec --json`'s shapes: `commandExecution`,
   `fileChange` and `mcpToolCall` items are renamed and read the same way, so
   tool names are `CODEX_TOOLS`' (`Bash`, `Edit`, `mcp__<server>__<tool>`), and
   a `declined` status reads as failed. Every other notification yields nothing,
   so the frame volume makes no events.
5. **Usage**: `thread/tokenUsage/updated` carries a running `total` for the
   thread, which may hold an earlier leg's. The leg's usage is `total` less what
   it held before the leg's first request (the first update's `total` less its
   `last`), so a resumed leg does not count the earlier ones twice
   ([L555](../gaps/codex-app-server-limits.md)). There is no price
   (`price: false`).

Codex's notifications share one connection across threads, so a codec reads only
frames whose `threadId` is its own thread's. A declined approval is not a reply
to Ork: it arrives as `item/completed` with status `declined`, and the codec
tags it `declined`, so the hook canary does not count it as a run tool (see
[L559](../gaps/codex-app-server-limits.md)).

## Approvals

Codex asks the host with a server request; the codec turns it into an `ask` that
goes to `ports.human.permit` with the node, the tool and its arguments, under
the client's rules ([duplex client](./duplex-client.md#what-the-client-does)).

- **A command** (`item/commandExecution/requestApproval`) is an ask for `Bash`
  with `{ command }`. A request of another kind (`writeStdin`, `humanCommand`)
  or with no command is declined.
- **A file change** (`item/fileChange/requestApproval`) carries no changes: the
  paths and diffs are on the `fileChange` item's `item/started`, which the codec
  remembers by item id, and the ask is for `Edit` with `{ changes }`. One whose
  item it has not seen, or with `grantRoot` set (writes under a root for the
  session), is declined ([L557](../gaps/codex-app-server-limits.md)). An ask is
  paired by the request's own `id`, as several requests can share one `itemId`.
- **The answer** is `{ decision: "accept" }` or `{ decision: "decline" }`, once.
  Never `acceptForSession`, never an execpolicy or network amendment.
- **Every other server request** is answered at once, so no turn waits on Ork,
  and never with an allow: `item/tool/call` as a failed call (Ork serves no host
  tools: [L553](../gaps/codex-app-server-limits.md)),
  `mcpServer/elicitation/request` as `decline`,
  `item/permissions/requestApproval` as an empty grant, the legacy
  `execCommandApproval` and `applyPatchApproval` as `denied`, and any other
  method (`item/tool/requestUserInput`, whose answer cannot say no,
  `account/chatgptAuthTokens/refresh`, anything new) as a JSON-RPC error. Ork
  never handles a credential.

The thread request sends `approvalPolicy: "on-request"` and
`approvalsReviewer: "user"`: Codex asks the host for what the sandbox would
refuse, grants nothing itself, and a user config's `auto_review` or
`guardian_subagent` never routes an approval to a model. `"untrusted"` is in the
schema, but the binary refuses it ("is no longer supported").

## The node's rules

The rules bind as on `codex`, and never weaker: no
`--dangerously-bypass-approvals-and-sandbox`, no `danger-full-access`, no
accept-for-session.

- **The sandbox** is `codexSandbox`'s (`read-only` or `workspace-write`), in the
  `thread/start` params and as `-c sandbox_mode`, with the policy as
  `-c approval_policy`.
- **Ork's MCP server** is `-c mcp_servers.ork.*` keys; its token is in the
  process environment only (`ORK_CODEX_MCP_TOKEN`, kept out of shells by
  `shell_environment_policy.exclude`), never in a thread request, an event or a
  log.
- **The PreToolUse hook** is `-c hooks.PreToolUse`, with its calls file and
  canary as on `codex`: a tool call that finished while the file's count did not
  grow ends the leg `driver_crashed` with `HOOK_DID_NOT_RUN`. `app-server` has
  no `--dangerously-bypass-hook-trust`, so every thread request carries
  `config: { bypass_hook_trust: true }`, which is guessed
  ([L550](../gaps/codex-app-server-limits.md)); if it is wrong, Codex refuses
  the thread or the hook never runs and the canary ends the leg.
- **The hook fence fails closed.** A user or system `hooks.json` refuses the
  session before it starts, as on `codex`, with a message that names both
  drivers' ways of trusting the hook. After `initialize`, `hooks/list` for the
  folder must show Ork's `preToolUse` hook (source `sessionFlags`) and no other
  enabled hook; otherwise the leg ends failed, naming where the foreign hook
  came from, before any thread. Whether the list before a thread holds every
  hook the thread runs is unmeasured
  ([L551](../gaps/codex-app-server-limits.md)).
- **What still loads.** `app-server` has none of `exec`'s `--ignore-user-config`
  or `--ignore-rules`, so the user's `config.toml` (its MCP servers, profile)
  and execpolicy `.rules` still apply: weaker than `codex`, with Ork's hook
  still seeing every call and the sandbox the outer wall
  ([L549](../gaps/codex-app-server-limits.md)).
- **Plugins and apps** are off (`--disable plugins`, `--disable apps`,
  `--disable remote_plugin`), as on `codex`.

## The capabilities

`questions: true`, `permissionPrompt: true`, `midTurnMessages: true` (before the
turn ends, not at once), `price: false`, `reportSchema: false` (reports use the
`report` tool, [G42](../gaps.md#gaps)), `turnLimit: false`, `mcpServers: false`,
`subagents: false`, `readDenies: false` ([G41](../gaps.md#gaps), as on `codex`;
`ork validate` refuses a node that needs one), `proven: false`. The adapter's
`permissions` are `{ kind: "callback", denyByDefault: true }`. The minimum
version is `codex`'s (0.169.0), and `ork doctor` checks the `codex` binary and
`codex login status` (the exit status only: Ork never reads `auth.json`).

## Pause, stop and deferral

There is no `hold` hook (as on `codex`, [G40](../gaps.md#gaps)), so the driver
never defers: `ork pause` lands at the turn's end and a shell call takes no
`heavy` slot. `ork stop` is a real `turn/interrupt` instead of a wait for the
leg's end; whether it ends a running command at once is unmeasured.

## Limits

[L548 to L559](../gaps/codex-app-server-limits.md): shapes from the schema and
not a run, the user's config and rules still loading, the guessed hook trust,
the fence's reach, a steer that may wait, no host tools, a refused call shown
twice, the usage baseline, unmeasured error codes and id formats, a file-change
ask built from a remembered item, and the handshake's later replies not bounded
in time.
