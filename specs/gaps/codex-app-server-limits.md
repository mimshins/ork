# Limits found building the `codex-app-server` driver

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.
The gaps found with them are G39 (closed by this driver) and G40 in
[the register](../gaps.md#gaps).

Found building [the `codex-app-server` driver](../runtime/codex-app-server.md)
([RFC-027](../../rfcs/archived/RFC-027-long-lived-protocol-drivers.md), the
`codex app-server` codec on [the two-way client](../runtime/duplex-client.md)).
The driver ships `proven: false`: no model was called while it was built, and
the protocol is experimental, so what only a real session can measure is listed
here as unmeasured. What was left simpler, or could not be checked:

- **L548 · The wire is read from the schema, not from a run.** Every method and
  field name comes from `codex app-server generate-json-schema` of codex-cli
  0.169.0 (the stable bundle), and the codec was tested on frames built from
  those names, never on a real session. Fixtures written by hand from the schema
  cannot catch a misreading of it; only a run on the real binary can. A shape
  that differs, or an experimental change in a later Codex, ends a leg failed or
  ignores a frame. The driver is refused by name until a capped gate run passes,
  which records the measured shapes against the limits below.
- **L549 · The user's `config.toml` and execpolicy rules still load.**
  `codex app-server` has none of `codex exec`'s `--ignore-user-config` or
  `--ignore-rules`, so the user's MCP servers, profile and `.rules` apply to the
  session: weaker than `codex`. Ork's PreToolUse hook still sees every call and
  the sandbox is the outer wall, so a node's tool rules hold; the node may also
  see tools or servers a clean `codex` session would not.
- **L550 · The hook's trust key is guessed.** `app-server` has no
  `--dangerously-bypass-hook-trust`, so every thread request carries
  `config: { bypass_hook_trust: true }`, a name taken from the binary's strings
  and not run. If it is wrong, Codex refuses the thread (the leg fails) or the
  hook never runs and the canary ends the leg `driver_crashed` at the first
  finished tool call (`HOOK_DID_NOT_RUN`); the node never runs without its
  rules.
- **L551 · The hook fence reads `hooks/list` before the thread.** The leg ends
  failed unless the list shows Ork's `preToolUse` hook (source `sessionFlags`)
  and no other enabled hook. Whether the list before a thread holds every hook
  the thread runs (a project's, the system's, a plugin's) is unmeasured; the
  canary still ends a leg whose hook did not run, but a foreign hook the list
  misses would run untrusted beside Ork's.
- **L552 · A steer may wait for a running command.** `turn/steer` reaches the
  model before the turn ends; whether Codex takes it before a running command
  ends, as `omp`'s `steer` waits for a running call, is unmeasured. The
  capability says "before the turn ends", never "at once". A steer sent before
  `turn/started` is held, since Codex refuses one with no turn.
- **L553 · Ork serves no host tools.** `item/tool/call` is answered as a failed
  call, never served; Ork's tools reach Codex through its MCP server as on
  `codex`, with the token in the environment. Serving them over the pipe is a
  later change
  ([RFC-027](../../rfcs/archived/RFC-027-long-lived-protocol-drivers.md), open
  question 8).
- **L554 · A call the hook refused may show twice.** The hook writes each
  refusal to its calls file and the canary turns it into a refused tool call;
  Codex may also report the declined item (`item/started`, `item/completed` with
  a `declined` status, read as failed). Guessed from the schema: unmeasured
  whether Codex reports a call its hook refused, so the log may hold the call
  twice.
- **L555 · The leg's usage is derived.** `thread/tokenUsage/updated` carries the
  thread's running total, which may hold an earlier leg's. The leg's usage is
  `total` less a baseline, the first update's `total` less its `last`. That
  `last` is one request's usage is unmeasured, so a resumed leg's figure may be
  off by what the first request used. No price (`price: false`).
- **L556 · The JSON-RPC error codes and id formats are unmeasured.** Only -32600
  was seen; Ork answers a method it does not serve with -32601 and sends string
  ids (`ork-1`, ...) where Codex accepts a string or an integer. A Codex that
  rejects either ends the leg failed with its message.
- **L557 · A file-change ask is built from a remembered item.** The request
  carries no changes: the codec keeps each `fileChange` item from `item/started`
  by id, and the ask names `Edit` with `{ changes }`. A request whose item the
  codec has not seen, or with `grantRoot` set, is declined, so a Codex that asks
  before it reports the item gets a refusal for a change a person would have
  allowed.
- **L558 · The handshake is bounded as a whole, not step by step.** The client
  gives the handshake 45 seconds from the spawn to `turn/started` (a codec that
  waits for the turn is started by it), so a Codex that never answers
  `hooks/list`, the thread request or `turn/start` ends the leg failed after
  that time. A thread that legitimately takes longer (a slow MCP server) fails
  too. An error reply to any step ends the leg failed at once.
- **L559 · A declined first call is not counted as a run tool.** The hook canary
  counts a finished call as proof the hook ran; a call Ork declined is not
  counted. If Codex runs `PreToolUse` only after an approval, a node whose every
  call is declined is not checked by the canary (it fails closed: nothing ran).
  The hook-versus-approval order is unmeasured; the gate run confirms it.
