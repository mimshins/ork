# Limits found building the `omp` driver

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.
The gaps found with them are G47 to G49 in [the register](../gaps.md#gaps) (G45
and G46 are closed). L497 to L502 came with the rpc path
([RFC-027](../../rfcs/archived/RFC-027-long-lived-protocol-drivers.md),
[the client](../runtime/duplex-client.md)) and L534 to L540 with host tools, the
model check and the deferral reason
([ADR-113](../../decisions/ADR-113-omp-host-tools.md)), both built and tested on
a fake `omp` that replays the spike's frames. L560 to L562 came with the gate
run.

Found building the `omp` driver (spec: [runtime/omp.md](../runtime/omp.md))
([RFC-026](../../rfcs/archived/RFC-026-omp-driver.md)), reading `omp` 18.22.2's
own documents and running its free hand check (no paid model call, a local
stand-in for the model), and on its capped gate run (2026-11-21,
[measured](../runtime/omp-gate.md#measured-on-the-gate-run)), which proved it.
L498, L501 and L536 were closed by the gate run and are gone. What was left
simpler, or could not be checked:

- **L464 · A pause that outlasts the hold window costs one resume.** A held call
  waits up to `OMP_HOLD_WINDOW_MS` (9 minutes, `claude-code`'s). Past it the
  runner ends the leg with an `abort` frame and, on `ork continue`, resumes the
  session with `--resume` and one message asking the model to make the held call
  again. A pause costs one resume (one cold prompt cache, one `omp` start-up,
  L500), not one request per window. Measured on the gate run: the deferral
  fired 9 minutes 0.0 seconds after the call was held, and the resumed leg made
  the call again and finished. Only one window was timed; a second one (a
  `heavy` slot's) was not.
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
  process after a bounded wait (10 seconds). A real `omp` answered the `abort`
  of a deferral with `prompt_result` of status `aborted` and `session_settled`,
  and exited, on the gate run; a user's `ork stop` of a held call was not run.
  If `omp` ignored the `abort` the leg would run on, every call refused, until
  the wait ran out.
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
  fork's ledger entry started from the source's spend (measured on the gate
  run); whether `omp`'s own `--max-cost` counted it was not read.
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
  list. `omp` is proven now, so the check runs for every installed `omp`, not
  only on request. The gate run took one `omp models --json` for the model
  check. A cached list would close it.
- **L478 · A new Ork tool needs an entry in the overlay.** With
  `tools.approvalMode: always-ask`, `omp` asks before a tool with no
  `tools.approval` entry, and a wildcard key did not work. Measured on the gate
  run for a host tool: with `ork_feedback` left out of the map, `omp` asked
  through a `select` and Ork's `Approve` let the call run and its `Deny` stopped
  it. On the print path (`--no-ui`) the same was a refusal ("requires approval
  but no interactive UI available"); over rpc it is a `select` Ork answers
  through the human channel, so a tool added to Ork later asks a person on `omp`
  until the overlay lists it by its `ork_<tool>` host tool name. It still fails
  closed (a person, or a deny, never an allow), but no longer fails loudly. The
  shipped overlay lists every Ork tool, so no shipped run reaches this path.
- **L479 · The overlay's values are not checked by `omp`.** An unknown key or a
  wrong-type value gave no error and no stderr: a typo does nothing. The tests
  read effective values back with `omp config get`, not the fact that a leg ran.
  A bare `off` in YAML is a boolean, so enum values are quoted.
- **L480 · A message sent during an `omp` call reaches the model after the
  call.** `omp` takes a `steer` frame mid-turn, but a running tool call finishes
  first, so a message reaches the model before the turn ends, not at once.
  Measured on the gate run: a steer written about 3 seconds into a 90-second
  `bash` call was answered at once and taken by the model 87 seconds later, when
  the call ended. A long `bash` call delays it by that long, and a message sent
  before `omp` says it is `ready` waits for the start-up (L500). Until it
  arrives, `read_inbox` and `wait_for_messages` still say "no message" (as L451
  for Codex).
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
  recognizes a chunk marker (a guess) and ends the leg failed with one line
  naming the limit. Shortcut: no reassembly; upgrade once a real chunked frame
  is captured. On the gate run a 2 MB single-line output did not make one: `omp`
  cut it to 768 bytes itself (`details.meta.limits.columnTruncated`, the rest
  kept as `artifact://0`), and the largest frame was 258,368 bytes, mostly the
  call's `details.trace.history`. How `omp` cuts a result that is large in
  lines, or a long file read, is not measured.
- **L499 · A cost cap over several prompts and protocol version 2 are not
  measured.** `--max-cost` over rpc is measured for one prompt: a node capped at
  $0.10 ended with `prompt_result` of status `error` and `error.code`
  `cost_cap`, `budget_limit`, with $0.1027 spent, equal to the ledger. A cap
  over several prompts of one process was not run (Ork sends one `prompt` per
  process, so it spans legs). `ready` lists `supportedProtocolVersions: [1, 2]`;
  the codec speaks protocol version 1 only, and a leg ran fine on it.
- **L500 · Every leg pays `omp`'s start-up, and its events are unfiltered.**
  `ready` came 10 to 12 seconds after the start (25 seconds once; 12.7 and 12.8
  seconds from a delegate call to the child's `ready` on the gate run), on every
  leg, so a deferral's resume and a leader's question fork each pay it, and a
  message sent before it waits. The client waits up to 45 seconds for it. One
  run sent 166 `message_update` frames, which Ork reads and drops;
  `set_event_filter` is not used. Neither is optimized.
- **L502 · An approval is paired with its call by order.** The `select`'s title
  names the tool (measured on the gate run) but not its arguments, so the codec
  pairs it first in, first out: it keeps the calls that started and are not yet
  paired, a `select` takes the oldest, and a `tool_execution_end` drops its
  call. A call the approval map decides up front (no `select`) still sits ahead
  of an asking call until its end frame, so if `omp` starts such a call and an
  asking one before either ends, a person is shown the wrong tool or arguments.
  It cannot allow a tool the overlay lists as denied; a `select` with no call to
  pair is cancelled, and one that offers no `Approve` and `Deny` is cancelled
  without taking a call. The gate run asked two calls in turn, never two at
  once, and the pairing held.
- **L534 · A host tool call has no timeout of Ork's own.** The runner waits for
  an Ork tool as long as it runs (`delegate` and `ask_user` can wait for hours),
  and writes its `host_tool_result` when it ends. On the gate run `omp` held an
  `ask_user` call open 2 minutes 29 seconds (the enclosing `ork_delegate` 2
  minutes 49 seconds) and delivered the answer, with no `host_tool_cancel` and
  no error result; whether it cuts a call that waits for hours is not known, and
  host tools have no timeout setting known (the plugin route set
  `OMP_MCP_TIMEOUT_MS=0`). A call still running when the leg ends has its answer
  dropped, not written.
- **L535 · `host_tool_cancel` and `loadMode` are not used.** `omp` can cancel a
  host tool call and sets a tool's `loadMode`; the codec answers no cancel and
  sends no `loadMode`, so a stopped call runs to its end in Ork (its answer
  dropped), and `omp` loads each Ork tool with its own default. Neither was
  measured: `omp` sent no `host_tool_cancel` on the gate run, so there was no
  case to read.
- **L537 · What `omp` reads from a failed host result is unmeasured.** The gate
  run measured `set_host_tools` (the request's `tools`, each with `name`,
  `description` and `parameters`, was accepted on every leg), `host_tool_call`
  and the result's `content`. No Ork tool call failed, so the result's `isError`
  and how a failed call is marked were not tested against a real `omp`. A
  `set_host_tools` error ends the leg failed with "omp refused the session's
  start: …".
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
- **L560 · A refused shell redirect is reported as "bash is not allowed for this
  node".** Found on the gate run: a redirect in a command of a node's prompt was
  refused, and the refusal the model read named the whole `bash` tool, not the
  redirect that caused it, so the model and the person reading the log cannot
  tell which part of the line the rules refused. Naming the redirect in the
  refusal would close it. Not specific to `omp`: the words come from the shared
  rules.
- **L561 · A report cut off by a deferral is logged as a failed report and files
  a false feedback item.** Found on the gate run: when a deferral's `abort` ends
  a leg while an `ork_report` host call is in flight, the call's answer is
  dropped, the log shows a failed report, and Ork files a feedback item ("hold's
  report was not accepted") although the node went on and reported after its
  resume. Telling a report refused by the node's schema from one lost to a
  deferral would close it.
- **L562 · A failed owner-fork plan falls back to a person with no log of why.**
  Found on the gate run: when the plan of a leader's question fork fails (the
  worktree bug that `fbd8b8fc` fixed was one cause), the question goes to a
  person with nothing in the run's log saying a fork was tried or why it was not
  made. An event or a log line naming the plan's failure would close it.
