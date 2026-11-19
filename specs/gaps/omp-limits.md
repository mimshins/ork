# Limits found building the `omp` driver

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.
The gaps found with them are G45 to G49 in [the register](../gaps.md#gaps).

Found building the `omp` driver (spec: [runtime/omp.md](../runtime/omp.md))
([RFC-026](../../rfcs/archived/RFC-026-omp-driver.md)), reading `omp` 18.22.2's
own documents and running its free hand check (no paid model call, a local
stand-in for the model). The driver ships `proven: false`: its gate run has not
been made, so what the run alone can measure is listed here as unmeasured. What
was left simpler, or could not be checked:

- **L464 · A pause that outlasts the hold window costs a model request.** `omp`
  cannot leave a call pending across processes, so a held call waits up to
  `OMP_HOLD_WINDOW_MS` (60 minutes). Past it the guard refuses the call and asks
  the model to make the same call again, which waits another window. Each window
  a paused node outlasts is one request with a cold prompt cache, counted toward
  the node's budgets, and it rests on the model repeating the call. A true
  deferral is G46. A wait longer than the 135 seconds of the hand check was
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
- **L467 · Stopping a held call rests on a marker and one SIGINT.** The wiring
  writes a `stopped` marker before the hold's answer goes out, and the guard
  refuses every call once it exists. On the hand check one SIGINT ended `omp` in
  about a second (exit 130, the call did not run, no process left). SIGINT in
  the middle of a turn with no held call, and SIGTERM, were not measured. If
  `omp` ignored the signal the leg would run on, every call refused, until its
  turn ended.
- **L468 · The user's own `omp` settings the overlay does not name apply.** The
  leg uses the user's agent folder and profile (their login stays where it is),
  with Ork's overlay and flags on top. A key the overlay does not name keeps the
  user's value, and with `OMP_MCP_REQUIRE_READY=1` a user's own MCP server that
  is down could end every leg. Whether the overlay's `disabledProviders` and
  `disabledExtensions` keep the user's servers out was not measured (the hand
  check used an empty agent folder). The `claude-plugins` provider must stay
  enabled, as Ork's plugin loads through it.
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
- **L471 · The token is in two files, and the guard's files can be rewritten.**
  Ork's token sits in the plugin's `.mcp.json` and in `hold.json`, both 0600 in
  a 0700 folder outside the checkout, gone when the session ends. The guard
  refuses `omp`'s own file tools on that folder but cannot fence a shell: a
  command the node's rules allow can read the token, or rewrite the guard, the
  hold file or the marker between legs (as L447 for Codex). The token opens only
  this session's Ork tools and hold.
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
  session, Ork's server not ready, a guard that did not load), told apart by the
  last block of stderr through the shared provider-error classifier; a changed
  sentence ends as `driver_crashed`. The lines `omp` prints for a failed model
  request, and the values `stopReason` takes besides `toolUse`, `stop` and
  `aborted`, were not captured.
- **L477 · `omp models --json` can take about 15 seconds on a fresh home.**
  `ork doctor`, `ork validate` and `ork run` read it for the login check, so
  they can wait that long on a machine where `omp` has not cached its model
  list, even while the driver is unproven. A cached list or a shorter wait for
  an unproven driver would close it.
- **L478 · A new Ork tool needs an entry in the overlay.** With
  `tools.approvalMode: always-ask`, `omp` refuses an MCP tool with no
  `tools.approval` entry ("requires approval but no interactive UI available"),
  before the guard sees it, and a wildcard key did not work. The overlay lists
  each Ork tool by its `mcp__ork_session_ork_<tool>` name, so a tool added to
  Ork later is refused on `omp` until its entry is added. It fails closed, and
  loudly.
- **L479 · The overlay's values are not checked by `omp`.** An unknown key or a
  wrong-type value gave no error and no stderr: a typo does nothing. The tests
  read effective values back with `omp config get`, not the fact that a leg ran.
  A bare `off` in YAML is a boolean, so enum values are quoted.
- **L480 · A message sent during an `omp` leg reads as none until the leg
  ends.** `omp -p` takes nothing mid-turn, so Ork holds the message for the next
  leg (`--resume`), and meanwhile `read_inbox` and `wait_for_messages` say "no
  message" (as L451 for Codex).
- **L481 · The driver leans on flags `omp --help` does not list.**
  `--trusted-extension`, `--plugin-dir` and `--fork` are in `omp`'s
  `cli-reference.md` and work on 18.22.2, but are not in `--help`. A release
  that drops one ends every leg with exit 2 ("unknown flag") and no model call;
  the doctor's minimum version does not catch a newer break.
- **L482 · What the user's own `omp` setup adds to a session is unmeasured.**
  `--no-skills`, `--no-rules`, `--trusted-extension` (which loads only Ork's
  guard) and the disabled providers keep the user's setup out of the session,
  but what the user's own extensions, rules, context files and MCP servers add,
  and how the repository's `AGENTS.md` is read, were not measured. `omp` also
  keeps Ork's MCP tools on whatever `--tools` lists; what an empty `--tools`
  does to them is not known, so a node with nothing to offer gets `read` alone,
  denied.
