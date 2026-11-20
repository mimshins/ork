# Limits found building the `omp` driver

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.
The gaps found with them are G47 to G49 in [the register](../gaps.md#gaps) (G45
and G46 are closed). L497 to L502 came with the rpc path
([RFC-027](../../rfcs/archived/RFC-027-long-lived-protocol-drivers.md),
[the client](../runtime/duplex-client.md)), built and tested on a fake `omp`
that replays the spike's frames, never run on a real `omp`. L534 to L540 came
with host tools, the model check and the deferral reason
([ADR-113](../../decisions/ADR-113-omp-host-tools.md)), built the same way.

Found building the `omp` driver (spec: [runtime/omp.md](../runtime/omp.md))
([RFC-026](../../rfcs/archived/RFC-026-omp-driver.md)), reading `omp` 18.22.2's
own documents and running its free hand check (no paid model call, a local
stand-in for the model). The driver ships `proven: false`: its gate run has not
been made, so what the run alone can measure is listed here as unmeasured. What
was left simpler, or could not be checked:

- **L464 · A pause that outlasts the hold window costs one resume.** A held call
  waits up to `OMP_HOLD_WINDOW_MS` (9 minutes, `claude-code`'s). Past it the
  runner ends the leg with an `abort` frame and, on `ork continue`, resumes the
  session with `--resume` and one message asking the model to make the held call
  again. A pause costs one resume (one cold prompt cache, one `omp` start-up,
  L500), not one request per window, but it still rests on the resume working
  (L498) and the model making the call again. A hold of the whole window was
  never timed.
- **L465 · A `heavy` slot is freed at once only after a `Bash` call that ran.**
  The guard's `tool_result` handler sends the after-call request for a `Bash`
  call. A call refused after the slot was taken emits no `tool_result`, so that
  slot frees at the session's next call or its end, as `heavyHook` already does.
  Two calls of one message may also end in either order, so the slot is matched
  by command, not by order.
- **L466 · A held call's request is counted late, and lost when the leg is
  stopped.** The assistant `message_end` of the request that made the call
  arrives only after the guard answers, so the token cap and `contextTokens` see
  it late. On `ork stop` while a call is held `omp` prints an aborted message
  with zero usage, so that request's usage is never counted.
- **L467 · Stopping a held call rests on a marker and an `abort` frame.** The
  wiring writes a `stopped` marker before the hold's answer goes out, and the
  guard refuses every call once it exists. On the hand check one SIGINT ended
  `omp -p` in about a second (exit 130, the call did not run, no process left).
  The rpc path writes an `abort` frame instead, then closes stdin and kills the
  process after a bounded wait (10 seconds), which the fake `omp` proves and a
  real one has not. If `omp` ignored the `abort` the leg would run on, every
  call refused, until the wait ran out.
- **L468 · The user's own `omp` settings the overlay does not name apply.** The
  leg uses the user's agent folder and profile (their login stays where it is),
  with Ork's overlay and flags on top. A key the overlay does not name keeps the
  user's value. Whether the overlay's `disabledProviders` (`claude-plugins`
  among them now that Ork's tools are host tools, not a plugin) and
  `disabledExtensions` keep the user's servers out was not measured (the hand
  check used an empty agent folder).
- **L469 · Dollars are catalogue prices, and some requests are on no line.**
  `omp` prices a request from its own catalogue, so a subscription login gets
  notional dollars and a model with no known price costs 0: `budgetUsd` alone
  does not bind such a node, and the capability cannot say so. A side request on
  no line, or one cut off before its line, is in neither Ork's count nor the
  outcome's cost.
- **L470 · The spend ledger is Ork's count, not `omp`'s.** `--max-cost` counts
  the whole session, so a resumed leg's value is the ledger's spend plus
  `budgetUsd` (`~/.ork/omp/spent/`, 0600). The ledger can be below `omp`'s
  count, so the cap errs tight, never loose. A session resumed after its entry
  was removed gets no credit for what it spent and may end at once at its cap. A
  fork's cap assumes `omp` counts the source session's spend; not measured.
- **L471 · The token is in one file, and the guard's files can be rewritten.**
  Ork's token sits in `hold.json` only (0600 in a 0700 folder outside the
  checkout, gone when the session ends); the plugin's `.mcp.json` is gone with
  the plugin. The guard refuses `omp`'s own file tools on that folder but cannot
  fence a shell: a command the node's rules allow can read the token, or rewrite
  the guard, the hold file or the marker between legs (as L447 for Codex). The
  runner's HTTP endpoint serves `/hold` only on `omp` (a `tools/list` is empty),
  so the token opens this session's hold endpoint and nothing else.
- **L472 · `omp` has no sandbox, so the guard is the only fence for file
  tools.** With `write` allowed, `omp` wrote outside the working directory
  (`/tmp/…` and `../`), and its approval settings are per tool, not per path.
  The guard refuses an `edit` or `write` whose real path is outside the worktree
  (`--yolo` included) and one whose path it cannot read; a `bash` command the
  node's rules allow runs with the user's rights. A path form the guard did not
  expect (`edit` takes one string that starts `[PATH#HASH]`; a `read` path may
  carry a selector suffix, a URL or an internal address; a `glob` path is a
  pattern) is for the gate run to measure.
- **L473 · A path-scoped `Read`, `Grep` or `Glob` deny removes all three read
  tools.** `omp` has no per-path wall, so `--tools` leaves out `read`, `grep`
  and `glob`, and the node reads through `extract`, which applies the patterns
  in Ork's process. A node that needs `read` and a path deny for one folder
  loses `read` altogether. This is what holds `readDenies: true`.
- **L474 · Session and ledger files are never pruned.** `~/.ork/omp/sessions/`
  holds whole transcripts and a lock file per leg, and `~/.ork/omp/spent/` one
  small file per session. Nothing removes either.
- **L475 · The model `omp` resolved is not recorded.** `session.started` carries
  the model as written, or `default`. A fuzzy name (`omp.opus`) or a configured
  role can resolve differently on two machines, and a node with no model runs
  `omp`'s own default; the run does not say which. A place for it needs a change
  to the runtime port.
- **L476 · Errors are read by text, and a failed request's lines were never
  seen.** Exit 1 has several meanings (no login, an unknown model, an unknown
  session, a guard that did not load), told apart by the last block of stderr
  through the shared provider-error classifier; a changed sentence ends as
  `driver_crashed`. The lines `omp` prints for a failed model request, and the
  values `stopReason` takes besides `toolUse`, `stop` and `aborted`, were not
  captured.
- **L477 · `omp models --json` can take about 15 seconds on a fresh home.**
  `ork doctor`, `ork validate` and `ork run` read it for the login check, so
  they can wait that long on a machine where `omp` has not cached its model
  list, even while the driver is unproven. A cached list or a shorter wait for
  an unproven driver would close it.
- **L478 · A new Ork tool needs an entry in the overlay.** With
  `tools.approvalMode: always-ask`, `omp` asks before a tool with no
  `tools.approval` entry (measured for the MCP route Ork's tools used to take; a
  host tool's is not re-measured), and a wildcard key did not work. On the print
  path (`--no-ui`) that was a refusal ("requires approval but no interactive UI
  available"); over rpc it is a `select` Ork answers through the human channel,
  so a tool added to Ork later asks a person on `omp` until the overlay lists it
  by its `ork_<tool>` host tool name. It still fails closed (a person, or a
  deny, never an allow), but no longer fails loudly.
- **L479 · The overlay's values are not checked by `omp`.** An unknown key or a
  wrong-type value gave no error and no stderr: a typo does nothing. The tests
  read effective values back with `omp config get`, not the fact that a leg ran.
  A bare `off` in YAML is a boolean, so enum values are quoted.
- **L480 · A message sent during an `omp` call reaches the model after the
  call.** `omp` takes a `steer` frame mid-turn, but a running tool call finishes
  first, so a message reaches the model before the turn ends, not at once. A
  long `bash` call delays it by that long, and a message sent before `omp` says
  it is `ready` waits for the start-up (L500). Until it arrives, `read_inbox`
  and `wait_for_messages` still say "no message" (as L451 for Codex).
- **L481 · The driver leans on flags `omp --help` does not list.**
  `--trusted-extension` and `--fork` are in `omp`'s `cli-reference.md` and work
  on 18.22.2, but are not in `--help`. A release that drops one ends every leg
  with exit 2 ("unknown flag") and no model call; the doctor's minimum version
  does not catch a newer break.
- **L482 · What the user's own `omp` setup adds to a session is unmeasured.**
  `--no-skills`, `--no-rules`, `--trusted-extension` (which loads only Ork's
  guard) and the disabled providers keep the user's setup out of the session,
  but what the user's own extensions, rules, context files and MCP servers add,
  and how the repository's `AGENTS.md` is read, were not measured. `omp` also
  keeps Ork's tools on whatever `--tools` lists (measured when they were MCP
  tools); what an empty `--tools` does to Ork's host tools is not known, so a
  node with nothing to offer gets `read` alone, denied.
- **L497 · A frame `omp` sends in chunks is not read.** `ready` reports
  `maxFrameBytes: 1048576` and says frames above it come in chunks; no chunk was
  captured, so its shape is unknown and cannot be reassembled blind. The codec
  recognizes a chunk marker and ends the leg failed with one line naming the
  limit. Shortcut: no reassembly; upgrade once a real chunked frame is captured.
  A long file read or a long result could reach it.
- **L498 · `--resume` after an `abort` was never run.** A deferral ends the leg
  with an `abort` and resumes it with `omp --mode rpc --resume <id>` and Ork's
  `--session-dir`. The fake `omp` proves Ork's side only; whether a real `omp`
  resumes the aborted session and continues the held call is not measured. The
  guard's refuse-and-repeat path is removed, so there is no fallback: if the
  resume does not continue, deferral is what to fix.
- **L499 · The cost cap over prompts and protocol version 2 are not measured.**
  `--max-cost` was measured on one print-mode prompt; over rpc a `prompt_result`
  with `error.code: "cost_cap"` ends the session `budget_limit` and the ledger
  counts each request as before, but a cap over several prompts of one process
  was not run. The codec speaks protocol version 1 only; version 2 is not read.
- **L500 · Every leg pays `omp`'s start-up, and its events are unfiltered.**
  `ready` came 10 to 12 seconds after the start (25 seconds once), on every leg,
  so a deferral's resume and a leader's question fork each pay it, and a message
  sent before it waits. The client waits up to 45 seconds for it. One run sent
  166 `message_update` frames, which Ork reads and drops; `set_event_filter` is
  not used. Neither is optimized.
- **L501 · Some wire names are guessed.** The spike measured `ready`, `steer`'s
  `message`, `response`, the approval `select` and its `value` answer, and
  `prompt_result`'s `status` and `sessionSettled`. Not measured, so chosen to
  match the rest: `prompt`'s `message`, the session id at `get_state`'s
  `data.sessionId`, the cancel answer's `cancelled: true`, an error's `message`
  and the chunk marker (L497). The gate run reads them off a real session.
- **L502 · An approval is paired with its call by order.** The `select` names no
  call, so the codec pairs it first in, first out: it keeps the calls that
  started and are not yet paired, a `select` takes the oldest, and a
  `tool_execution_end` drops its call. A call the approval map decides up front
  (no `select`) still sits ahead of an asking call until its end frame, so if
  `omp` starts such a call and an asking one before either ends, a person is
  shown the wrong tool or arguments. It cannot allow a tool the overlay lists as
  denied; a `select` with no call to pair is cancelled, and one that offers no
  `Approve` and `Deny` is cancelled without taking a call.
- **L534 · A host tool call has no timeout of Ork's own.** The runner waits for
  an Ork tool as long as it runs (`delegate` and `ask_user` can wait for hours),
  and writes its `host_tool_result` when it ends. Whether `omp` cuts a
  `host_tool_call` that waits long, and what the model then sees, was not
  measured; the plugin route set `OMP_MCP_TIMEOUT_MS=0` for this, and host tools
  have no such setting known. A call still running when the leg ends has its
  answer dropped, not written.
- **L535 · `host_tool_cancel` and `loadMode` are not used.** `omp` can cancel a
  host tool call and sets a tool's `loadMode`; the codec answers no cancel and
  sends no `loadMode`, so a stopped call runs to its end in Ork (its answer
  dropped), and `omp` loads each Ork tool with its own default. Neither was
  measured.
- **L536 · Whether the guard sees a host tool's call is unmeasured.** The guard
  maps `ork_<tool>` to `mcp__ork__<tool>` and applies the node's rules, hold and
  stop marker as for any call, but only if `omp` fires `tool_call` for a host
  tool. If it does not, the overlay's per-tool `deny` is the only wall for Ork's
  tools: a node's `deny` of one still holds, an `only` or path rule on its
  arguments and the pause hold do not. The gate run measures it.
- **L537 · Two host tool shapes are guessed.** The spike measured
  `set_host_tools` answering `{toolNames}`, a `host_tool_call`'s `id`,
  `toolCallId`, `toolName` and `arguments`, and a result's `content`. Not
  measured, so chosen to match: the request's field `tools` (an array of `name`,
  `description`, `parameters`), the result's `isError` and how a failed call is
  marked. A `set_host_tools` error ends the leg failed with "omp refused the
  session's start: …"; a wrong field name would do that on every leg.
- **L538 · The model check reads only an exact form, and costs a process.** A
  node's model is checked against the `selector` of each entry of
  `omp models --json` only when it is `provider/model` with no `{{`; a fuzzy
  name (`omp.opus`), a role and a templated model are left to `omp` and fail at
  the session, as before. The match is exact and case-sensitive, so a
  `provider/model` that `omp` would resolve loosely is refused ("not in
  `omp models`"). A list that fails, times out or is empty says nothing. The 15
  seconds `omp models --json` can take on a fresh home (L477) now also applies
  to `ork run` and `ork resume` once, when a node names an exact `omp` model.
- **L539 · The model check is in `ork run` and `ork resume` only.**
  `ork validate` stays offline, and `ork run --node` and `ork chat` do not
  check, so an unknown exact model there still fails when the session starts.
  Running the check there waits until the preflight's form is settled.
- **L540 · The guard's refusal text still says Ork paused the node on a slot
  deferral.** The resume message names the real reason (a pause, or a `heavy`
  slot that was not free), but the guard's refusal, which the model reads first,
  is "Ork paused this node, so this call did not run." on both. Carrying the
  reason in the hold hook's answer, and following it in the fake's `PAUSED`
  pattern, would close it.
