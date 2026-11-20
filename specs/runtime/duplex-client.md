# The two-way session client

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built** for `omp` only
([RFC-027](../../rfcs/active/RFC-027-long-lived-protocol-drivers.md), Option A;
[ADR-108](../../decisions/ADR-108-duplex-session-client.md)). The client
([session-duplex-leg.ts](../../packages/runtime/src/session-duplex-leg.ts),
[frame-lines.ts](../../packages/runtime/src/frame-lines.ts),
[leg-step.ts](../../packages/runtime/src/leg-step.ts),
[session-leg-input.ts](../../packages/runtime/src/session-leg-input.ts)), the
runner's routes
([session-runner.ts](../../packages/runtime/src/session-runner.ts)) and the
`omp` codec ([omp-rpc.ts](../../packages/runtime/src/adapters/omp-rpc.ts)) are
tested on a fake `omp` that replays the spike's frames
([tests](../../packages/runtime/test/session-duplex-leg.test.ts)); nothing here
is proven on a real `omp` ([limits](../gaps/omp-limits.md)). The
`codex app-server` codec is a later plan under the same RFC, so the RFC stays
open ([G39](../gaps.md#gaps)).

## Two ways to drive a tool

A [`CliAdapter`](../../packages/runtime/src/adapter.ts) has one of two ways to
reach its process, never both:

- **The one-way pipe** (`claude-code`, `open-code`, `command-code`, `codex`): a
  process per leg whose stdout the adapter's decoder reads. The brief is in the
  arguments or the first stdin line (`command.input`); a tool with no stdin
  takes a message at the next leg, which resumes the session with it
  ([`runLeg`](../../packages/runtime/src/session-leg.ts)).
- **The two-way client** (`omp`): the adapter sets `protocol`, a factory for a
  fresh `Codec` per leg (as `legDecoder` is). One long-lived process speaks
  newline-delimited JSON frames both ways, and the runner drives it with
  `runDuplexLeg`. The leg's spawn, orphan guard, event settling and end are the
  one-way pipe's (`spawnLeg`, `legStep`), so a session ends, is stopped and is
  combined across legs the same way.

## The codec

The client owns the process, the line reader and the table of requests Ork has
written; a codec only maps frames. Its parts:

| Part                       | What it does                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(spec, leg)`          | the leg's first requests: Ork's host tools when the leg has any, then the spec's prompt, and on a leg resumed after a deferral the resume message instead (any other resume opens with the node's prompt) |
| `decode(frame)`            | events (usage included), and optionally `ready`, a `reply` to a request, an `ask`, a `call` of a host tool, frames to `write` back at once, or a `fail` that ends the leg                                 |
| `message(text)`            | a request that reaches the model before the turn ends                                                                                                                                                     |
| `interrupt()`              | a request that stops the turn; the session settles after it                                                                                                                                               |
| `answer(ask, choice)`      | the frame that answers an `ask`: allow or deny, never "allow for the rest of the session"                                                                                                                 |
| `callResult(call, result)` | the frame that completes a `call`, with the tool's `ToolText`                                                                                                                                             |

## What the client does

- **Handshake.** It waits for the tool's `ready` (bounded at 45 seconds, since
  the spike saw 25 once) and only then writes `open`'s requests and any message
  that came sooner. A `ready` that does not come ends the leg failed, with the
  time named.
- **Requests.** Each request Ork writes carries an `id`; the tool's response
  carries it back. A response with an error, or a request still unanswered when
  the process exits or the leg is interrupted, rejects its promise; nothing is
  left pending, no timer is left running.
- **Messages.** `Session.send` writes `codec.message` to a running duplex leg,
  and queues it until `ready` on one that is not open yet. "Before the turn
  ends" is the promise, not "at once": a tool call that is running finishes
  first.
- **Asks.** An `ask` goes to `ports.human.permit` with the node, the tool and
  its arguments, the same call Ork's `permission` tool makes, under a signal the
  leg's end aborts. An allow and a deny are answered; a failed or withdrawn
  `permit` is a deny. A frame the codec cannot read as an ask is answered as a
  cancel by the codec, never as an allow.
- **Host tools.** An adapter with `hostTools: true` takes Ork's tools over its
  protocol: the runner binds them as it does for an MCP endpoint, passes them in
  `LegContext.hostTools` (each a `HostTool`: `name` as the model sees it,
  `description`, `parameters` as the tool's JSON Schema, and `call`), and starts
  its HTTP server with the hold handler only. A `call` the codec decodes
  (`DecodedFrame.call`: `id`, `tool`, `args`) is run by
  [host-calls.ts](../../packages/runtime/src/host-calls.ts): it finds the tool
  by name, calls it and writes `codec.callResult`. Calls may overlap (`delegate`
  and `ask_user` wait long); each is answered by its own id. An unknown name,
  bad arguments or a thrown error is answered with an error result that starts
  with `Ork tool failed:` or `Invalid arguments, nothing ran:`, as the MCP
  server's tools give; an answer that comes after the leg has ended is dropped,
  not written.
- **A frame that is not one.** A line that is not JSON, a line over
  `MAX_FRAME_LINE_BYTES` (1 MiB plus 64 KiB of slack: the tool's own limit is 1
  MiB) or a frame the codec marks `fail` ends the leg `failed` with one line
  naming the cause and the process's stderr tail, through
  `classifyProviderError`, never a hang or half a frame.
- **The session's end.** A turn's result is only a marker: the session ends at
  the frame the codec turns into `session.finished`, which `omp` calls
  `session_settled`, because a turn can end and a wake-up start another. The
  client then closes stdin and gives the process a bounded time (10 seconds) to
  exit, then kills it.
- **A stop.** `interrupt()` writes the codec's interrupt, waits the same bounded
  time for the session to settle, then closes stdin and kills the process. The
  session ends `interrupted` with no report, as on every driver.
- **A deferral.** When the hold hook answers "defer" past the window, the
  runner's `onDefer` calls the leg's `defer`: the leg writes the interrupt,
  waits for the settle (bounded), closes, and returns `deferred` with the
  session id and the usage so far. The runner waits for `ork continue` and its
  `heavy` slot, then starts a leg with the id, whose codec opens with its resume
  message (only after a deferral; any other resume opens with the node's own
  prompt, as on every driver). A stop while deferred ends `interrupted` and
  never resumes. A protocol session that never named itself cannot resume, so it
  ends `driver_crashed`. `omp`'s codec learns the id from a `get_state` request
  it sends before `prompt`; a deferral before that answers leaves no id.
- **Which id a resume uses.** The runner sets `LegContext.deferredFor` (a fourth
  argument of `legInputOf`) only when the leg resumes a deferral: it is
  `"pause"` or `"slot"`, the reason the hold hook gave (`onDefer(reason)`), and
  the codec picks its resume message by it (a pause: the node was paused; a
  slot: the call waited for a free `heavy` slot, now taken). A fork leg's
  `legSpec.resume` holds the source's session id, not the fork's: the leg's own
  id is `leg.sessionId`, and `legSpec.resume` is only the fallback when none was
  named; never take it as a fork's own id for a later resume.

## Limits

[L497 to L502 and L534 to L537](../gaps/omp-limits.md): chunked frames are not
read, the resume after an `abort` is not measured, unmeasured wire names, cost
cap and protocol version 2, start-up and event volume, approvals paired by
order, and what host tools leave unmeasured (call timeout, cancel, `loadMode`,
the guard's `tool_call`, the request's and result's shapes).
