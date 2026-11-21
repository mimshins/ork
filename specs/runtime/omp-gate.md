# The `omp` gate run

_Part of [The `omp` driver](./omp.md)._

Status: **Built and proven** on 2026-11-21: the capped gate run on a real `omp`
passed, and `proven` is `true` on the descriptor
([cli-drivers.ts](../../packages/integrations/src/cli-drivers.ts)). The frame
and timing facts below come from that run's frame and guard logs; the logs hold
the sessions' text and stay out of the repository, so only field names, codes,
timings and costs are written here.

## Measured on the gate run

On 2026-11-21, `omp` 18.22.2 (oh-my-pi), the Anthropic provider, signed in with
the maintainer's Claude subscription (so the dollars are notional, as
[L469](../gaps/omp-limits.md) says). Every node ran
`anthropic/claude-sonnet-5-5` at effort `low`, except the leader's leg of the
fork probe, which ran an Opus-class model. The runs were `gate` (steer,
approvals, a short and a long pause), `gate-cap`, `gate-chunk` and `gate-ask` (a
leader, its worker and the question fork, and one long host call), under caps of
$10, $2 and $2. The whole gate spent about $0.75. It ran from a copy of Ork's
source with `proven` set and two changes no shipped run has: a tee of every rpc
frame and every guard call to a file, and an overlay with no entry for the
`ork_feedback` tool, so that `omp` asked (the shipped overlay lists every Ork
tool, so a shipped run never reaches the approval path
([L478](../gaps/omp-limits.md))).

- **A steer during a running tool**: `steer` was written about 3 seconds into a
  90-second `bash` call and answered at once (`response`, `command: "steer"`,
  `success: true`, then a `queue_update` with the message under `steering`). The
  message reached the model after the call ended, not before: `queue_update`
  showed it taken (`steering: []`) 87 seconds later, when the call finished
  ([L480](../gaps/omp-limits.md)).
- **Approvals**: `omp` asked through an `extension_ui_request` of method
  `select`, with the options `Approve`, `Approve <tool> for this session` and
  `Deny`; its title names the tool and carries no arguments. Ork answered with
  an `extension_ui_response` whose `value` was `Approve`, then `Deny`. The
  allowed call became a `host_tool_call`; the denied one never did. Ork never
  sent the `for this session` option.
- **A short pause** (about one minute): the held call ran after `continue` in
  the same `omp` process; no second `ready`, no new process.
- **A long pause** (the 9-minute window): the guard held the call 9 minutes 0.0
  seconds (held at 09:15:39.3, `abort` at 09:24:39.3 by the logs' UTC clock).
  The runner wrote an `abort` frame; `omp` answered `response`
  (`command: "abort"`, `success: true`), then `prompt_result` with
  `status: "aborted"` and `sessionSettled: true`, then `session_settled`, and
  the process exited. The held call did not run. After `ork continue` a new
  process started with `--resume <id>` and Ork's session folder, said `ready`,
  took the resume message as its `prompt`, made the call again and finished
  (`status: "completed"`). The 9-minute window stays as it is
  ([L464](../gaps/omp-limits.md); the resume's L498 is closed).
- **A long host call**: an `ask_user` host call stayed open 2 minutes 29
  seconds, and the enclosing `ork_delegate` call 2 minutes 49 seconds; the
  answer reached the model, with no `host_tool_cancel` frame and no `isError`
  result. So `omp` does not time out a host call within about 3 minutes
  ([L534](../gaps/omp-limits.md)). It sent no `host_tool_cancel`, so that frame
  and `loadMode` stay unmeasured ([L535](../gaps/omp-limits.md)).
- **A cost cap**: a node with a `budgetUsd` of $0.10 (`--max-cost 0.1`) was told
  to run 60 commands and stopped after 15. `omp` sent a `notice` frame
  (`level: "error"`, `source: "cost-gate"`), then `prompt_result` with
  `status: "error"`, `sessionSettled: true` and
  `error: {message, retryable: false, code: "cost_cap"}`, then
  `session_settled`. The node ended `budget_limit` with $0.1027, equal to the
  ledger's count. A cap over several prompts of one process is not measured
  ([L499](../gaps/omp-limits.md)).
- **A large tool output** (one line of 2 MB): `omp` cut it itself. The tool's
  text for the model was 851 characters, and its `details.meta.limits` said
  `columnTruncated` with `maxColumn: 768`, `unit: "bytes"` and `artifactId: "0"`
  (the rest is kept as `artifact://0`). No chunked frame ever reached Ork. The
  largest frame was 258,368 bytes, under `maxFrameBytes`: `omp` also sends the
  call's `details.trace.history` (about 254 KB here) in the
  `tool_execution_update`, `tool_execution_end`, `message_start`, `message_end`,
  `turn_end` and `agent_end` frames. Whether a result that is large in lines
  rather than in one line is cut the same way is not measured
  ([L497](../gaps/omp-limits.md)).
- **Host tools**: `set_host_tools` with the field names Ork chose (`tools`, each
  `name`, `description`, `parameters`) was accepted, every leg, and answered
  `{toolNames: […]}` with each `ork_*` tool. `host_tool_call` is
  `{id, toolCallId, toolName, arguments}` and Ork's `host_tool_result` is
  `{id, result: {content: [{type: "text", text}]}}`, as written; `omp` echoes it
  in a `tool_execution_end` with `isError: false`. No Ork tool call failed on
  the run, so what `omp` reads from a failed result (`isError` or only the text)
  is unmeasured ([L537](../gaps/omp-limits.md)).
- **The guard sees Ork's tools** (L536, closed): the guard log has
  `ork_delegate`, `ork_ask_user`, `ork_report` and `ork_feedback` beside `bash`
  and `write`, so `omp` fires `tool_call` for a host tool, and the node's rules
  and the pause hold apply to Ork's tools.
- **The question fork**: a leader's `--fork <id>` process answered its worker's
  question. The fork's session file header carries `parentSession` (the leader's
  id) and a new `id`; its ledger entry started from the leader's spend, as
  [L470](../gaps/omp-limits.md) assumed. `omp` has no turn limit, so the fork's
  `FORK_MAX_TURNS` cannot be enforced on it. The probe also found a bug in Ork,
  not in `omp`, fixed on `main`: a leader with its own worktree never got a
  fork, whatever the driver, because the plan failed on worktree isolation.
- **A wrong model** (an `omp.<provider>/<model>` that `omp models --json` does
  not list) was refused before any session, naming the model.
- **Start-up**: from the `ork_delegate` call to the child's `ready`, 12.7 and
  12.8 seconds (the earlier 10 to 12 seconds, [L500](../gaps/omp-limits.md)).
  The `ready` frame reported `protocolVersion: 1`,
  `supportedProtocolVersions: [1, 2]`, `maxFrameBytes: 1048576`,
  `maxReassembledFrameBytes: 67108864` and `supportsBashExcludeFromContext`.
- **The wire names Ork guessed held**: `prompt`'s `message`, `get_state`'s
  `data.sessionId`, `set_host_tools`' `tools`, the result's `content` and an
  error's `message` were all right (L501, closed), so the codec needed no
  change. The rpc stream carried no `session` frame (the codec reads the id from
  `get_state`); the `session` header is the first line of the session file.
- **Other frames** the codec passes to the decoder or ignores: `queue_update`,
  `notice`, `available_commands_update`, `advisor_cost_changed` and
  `extension_ui_request` of method `setWidget`.
- **No `omp` process was left running** after any run.

## Not measured

Each is in [omp's limits](../gaps/omp-limits.md): a second hold window (a
`heavy` slot's), a cap over several prompts of one process, a resumed fork's
header, how `omp` cuts a result large in lines, `host_tool_cancel` and
`loadMode`, what `omp` reads from a failed host result, and an approval while
two calls are open. Three small findings of Ork's own are L560 to L562 there.
