# ADR-108 — A two-way session client in the runner, with `omp` on `--mode rpc`

- **Status:** Accepted
- **Date:** 2026-11-20
- **Topic:** runtime
- **RFC:** [RFC-027](../rfcs/active/RFC-027-long-lived-protocol-drivers.md)
  (Accepted; stays open until the `codex app-server` codec ships)
- **Amends:** [ADR-105](./ADR-105-omp-driver.md)

## Context

[ADR-076](./ADR-076-cli-drivers-only.md) put every driver behind one session
runner that spawns a tool's CLI for each leg and reads its output one way.
[ADR-105](./ADR-105-omp-driver.md) left `omp` (and
[ADR-102](./ADR-102-codex-driver.md) left `codex`) with a message that waits for
the leg's end and no approval Ork can answer. For `omp`, a pause that outlasts
the hold window ([ADR-041](./ADR-041-pause-continue-stop.md)) cost one model
request for each window, because the leg could not be ended and resumed. RFC-027
weighed a two-way client in the runner, one in each adapter, one process a leg,
and the Agent Client Protocol, and measured `omp --mode rpc` in a paid spike
(steer, abort, approvals, `ready` after 10 to 25 s, frames up to 1 MiB).

## Decision

All by the maintainer: RFC-027 accepted 2026-11-20 (Option A), and the plan for
this build, 2026-11-20. None is hard to reverse beyond the code and its tests.

- **One two-way client in the runner, a codec for each driver.** An adapter may
  carry a `protocol` codec instead of `command.input`: it opens a leg with its
  first requests, decodes a frame into the events and settling the runner
  already knows, and writes a message, an interrupt and an answer as frames. The
  duplex leg (`session-duplex-leg.ts`) keeps one process up, matches each
  request Ork sent to its response, fails every unanswered request when the
  process exits or the leg is interrupted, and reads frames with a line bound (1
  MiB plus slack). The one-way pipe stays for every driver without a codec. The
  port in `core` does not change (`send` and `interrupt` already exist).
- **`omp` runs on `omp --mode rpc` for every leg, with no print fallback.** The
  print path (`-p --mode json`) is removed, and so is `--no-ui`, so the host's
  `select` requests reach Ork. `midTurnMessages` and `permissionPrompt` become
  `true`; the adapter's `permissions.kind` is `callback`. A message is a `steer`
  frame, so it reaches the model before the turn ends (a running tool call
  finishes first); an interrupt is an `abort` frame, then a close, then a
  bounded kill.
- **Approvals through Ork's human channel.** A `select` offering `Approve` and
  `Deny` goes to the same permit call `claude-code`'s permission tool uses, with
  the tool and arguments of the `tool_execution_start` that came before it
  (paired by order). Ork never answers `Approve … for this session`. A request
  it cannot read, or a `select` with no such option, is answered as a cancel; a
  request of another method is ignored. The guard and the settings overlay are
  unchanged, so the tools that can ask are the ones they already name.
- **A session ends at `session_settled`,** not at the first `prompt_result`
  (which is a turn marker); a `prompt_result` with `error.code: "cost_cap"` ends
  the session with the cost outcome. A process exit before the end, a frame that
  is not JSON, or a frame over the line bound ends the leg `failed` with the
  stderr tail.
- **True deferral on `omp`.** The guard still holds a paused node's call, for
  `claude-code`'s window (9 minutes). Past it the runner sends `abort`, waits a
  bounded time for the turn to settle, closes the process and ends the leg
  `deferred` with the session id and usage. `ork continue` starts
  `omp --mode rpc --resume <id>` with Ork's session folder and one message
  asking the model to make the held call again (never the spec's prompt); any
  other resume sends the node's own prompt, as on every driver. A pause costs
  one resume, not one request for each window. The guard's refuse-and-repeat
  answer is removed, so there is no fallback if the resume does not continue.
- **Chunked frames end the leg with a diagnostic.** `ready` reports a frame
  limit and that larger frames are chunked, but the shape of a chunk was never
  captured, so the codec detects a chunk marker and ends the leg naming the
  limit. No reassembly until one is captured.
- **Unchanged:** Ork's tools reach `omp` through ADR-105's plugin and MCP
  endpoint (host tools over rpc are a later change); the ledger and `--max-cost`
  arithmetic; `proven: false`, so `ork validate` and `ork run` still refuse
  `omp`. No workflow-format field, no `schemaVersion` impact, no new dependency.
- **The `codex app-server` codec is a later plan,** on this client. It amends
  this ADR (whether it replaces `codex exec` or is a new driver id is then the
  maintainer's), and RFC-027 closes with it.

Contract: [the runtime spec](../specs/runtime.md),
[session ends](../specs/runtime/session-ends.md) and
[the `omp` driver](../specs/runtime/omp.md).

## Options considered

Weighed in RFC-027: A a shared two-way client with a codec each (chosen), B a
client in each adapter, C one process a leg with the message waiting for its end
(the status quo), D the Agent Client Protocol. For deferral: end the leg at a
long pause and resume it (chosen), or keep refusing the call and repeating it in
the same leg. For frames: reassemble chunks blind, or end the leg with a
diagnostic until one is captured (chosen).

## Rationale

The two protocols the RFC measured share what the one-way pipe cannot do: carry
a message into a running turn, interrupt with a frame, and ask Ork a question.
One client with a codec each puts that machinery, and its failure handling
(pending requests, orphan processes, the line bound), in one place instead of
two adapters. The runner already ends a `claude-code` leg at a long pause and
resumes it, so ending the `omp` leg the same way removes the cost ADR-105
recorded, and the shared `Leg` result keeps budgets, usage and the end reasons
as they were. Refusing a frame Ork cannot read, rather than guessing, keeps a
tool's approval request from being allowed by default.

## Consequences

- A second runner path to keep true beside the one-way pipe, tested by a fake
  `omp --mode rpc` that replays the spike's frames.
- Deferral rests on a resume after an `abort` that was never run on a real
  `omp`; the gate run measures it, and until then it is a limit in
  [the register](../specs/gaps/omp-limits.md) (with chunked frames, the cost cap
  over prompts, start-up time, and protocol version 2). G45 and G46 close; G39
  stays open until the `codex` codec.
- Each leg pays `omp`'s start-up (10 to 25 s) and a deferral pays it again; the
  unfiltered event stream is not trimmed yet.
- Follow-ups after merge: the capped gate run that sets `omp` to `proven`, the
  `codex app-server` codec, and host tools over `set_host_tools`.
