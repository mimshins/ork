# Resuming a run, and run events

_Part of [Scheduler: running a workflow](../scheduler.md)._

## Resuming a run

`ork resume` ([CLI](../cli/running-and-runs.md#resuming-a-run),
[ADR-026](../../decisions/ADR-026-resume-by-replay.md)) runs the workflow again
under the same run id, with a `Replay` built from the run's events:

- Each flow activation gets the result its node recorded last time, in order,
  without running and without `node.started`/`node.finished`; outputs, rounds,
  leaders' session ids, joins, routers and loop counts are rebuilt as before.
- A node's results are handed back up to its first that failed or never
  finished; from there it runs. A new result marks its output, and an activation
  whose input carries one (directly, or in a join's `results`) runs too.
  Delegated runs are never handed back: their leader's session runs them.
- **A run resumed more than once is one history.** A result a later resume
  recorded extends the node's results, and a new run of a round replaces what
  that round and later ones recorded, so a source that succeeded in an earlier
  resume is handed back, not run again.
- **A node cut off mid-session continues it.** When the run was stopped,
  crashed, ran out of budget or timed out (not when it failed), a node whose
  last activation never finished well resumes the Claude session it had, once,
  told that the run was stopped and to carry on from what it finished
  ([resume.ts](../../packages/core/src/run/resume.ts), `cutOff`). A node that
  failed in a failed run starts fresh.
- **A fanned node** ([RFC-013](../../rfcs/archived/RFC-013-for-each.md)) that
  succeeded is handed back whole; its items neither run nor replay. Otherwise it
  fans out again:
  - The list is the recorded `each.listed` of that round when its source was
    handed back, or it has none (`items:`), so an edited file can't move results
    between items. A source that ran anew gives a new list, and then every item
    runs anew and no cut session continues, since it was another item's. A
    handed-back list is what the store kept, masked like a handed-back output. A
    list resolved anew is marked `anew` on its `each.listed`, which drops what
    that round's items recorded before, in this resume and any later one.
  - Each item is handed back by its id and its node's round, so items finishing
    in any order get their own result back. An unfinished item runs again, and
    one cut off mid-session continues it. `session: resume` finds the session of
    a round handed back whole.
  - Runs from before have none of these events or fields, and resume unchanged
    ([replay.ts](../../packages/core/src/run/replay.ts)).
- A `node.finished` from before ends existed has no `end`; `endOf` reads its
  kind from its `error` text, and the stored event stays as it was
  ([how a session ends](../runtime/session-ends.md#runs-from-before)).
- `run.started` records `budgetUsd`, the tighter of the workflow's budget and
  what a caller left it, for showing a run's spend against.
- `run.started` carries the run's `inputs` and `settings` (`inPlace`, `driver`),
  which the resumed run starts with; the CLI records `run.resumed` with the
  nodes that keep results first.
- `run.started` and `run.resumed` carry `ork`, the version of Ork that started
  or resumed the run, so a benchmark knows what it measured.
- Decision ids go on from the highest the run stored. A decision the last
  process left open is withdrawn (`decision.withdrawn`), and its session asks
  again under a new id.
- Questions about loops out of rounds, and about lists over their `maxItems`,
  that were answered last time get the same answers again, in order.
- The bus starts with the run's unread and queued messages
  ([messaging](../messaging.md#message-bus)).
- The run's budget counts what it spent before.

## Run events

`onEvent` receives every change; `ork run` stores each one in the
[event store](../event-store.md) before printing it:

| Event               | When                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run.started`       | the run starts: id, workflow, entries, every declared node and owner, its edges and channels                                                                                                                                   |
| `node.started`      | an activation starts: id, type, round, `owner` and an optional `description` (at most 80 characters) when delegated, `item` (of, index) for an item of a fanned node, and the `agent` that fills it (name, source, file, hash) |
| `each.listed`       | a fanned node resolved its list (again if cut to `maxItems`): node, round, count, list, `anew` when a resumed run resolved it itself                                                                                           |
| `each.exceeded`     | a fanned node's list is over `maxItems`: node, round, count, maxItems                                                                                                                                                          |
| `node.event`        | a runtime event from the node's session or tool                                                                                                                                                                                |
| `node.finished`     | an activation ends: ok, output, usage, error, `end` ([kind](../runtime/session-ends.md); absent before)                                                                                                                        |
| `node.skipped`      | a dead path skips the node                                                                                                                                                                                                     |
| `edge.taken`        | an edge is taken                                                                                                                                                                                                               |
| `loop.exhausted`    | a loop edge is out of rounds                                                                                                                                                                                                   |
| `watch.started`     | a [`watch:`](./watching.md) begins: until, every, timeout                                                                                                                                                                      |
| `watch.changed`     | a look said something the last one didn't: looks so far, ok, what it said                                                                                                                                                      |
| `watch.ended`       | how the wait ended, and how many looks it took                                                                                                                                                                                 |
| `worktree`          | a worktree is created, committed to, merged, conflicts, or removed                                                                                                                                                             |
| `message.sent`      | a node wrote to another on the message bus: number, recipient, body; `via: rule` for a `notify:`                                                                                                                               |
| `message.read`      | a node read its inbox: the message numbers                                                                                                                                                                                     |
| `owner.asked`       | the run asked a live owner about a loop of a node it owns                                                                                                                                                                      |
| `owner.answered`    | the owner answered with `answer`                                                                                                                                                                                               |
| `owner.unanswered`  | the owner's session ended first; the human is asked instead                                                                                                                                                                    |
| `user.message`      | `ork chat` wrote to a node: delivered now, queued, or by resuming                                                                                                                                                              |
| `claim.taken`       | a node claimed a resource                                                                                                                                                                                                      |
| `claim.refused`     | a claim overlapped another node's: who holds what                                                                                                                                                                              |
| `claim.released`    | a node released a claim, itself or by finishing                                                                                                                                                                                |
| `feedback.recorded` | an agent's report, or a signal Ork derived ([feedback](../feedback.md))                                                                                                                                                        |
| `run.resumed`       | `ork resume` continues the run: the nodes that keep their results                                                                                                                                                              |
| `call.started`      | a `workflow.call` started a run: its node, the run, the workflow and the project ([calls](./calls.md))                                                                                                                         |
| `message.received`  | a linked node of another run, or `via: script` a program, wrote to it ([messaging](../messaging/scripts.md))                                                                                                                   |
| `link.notice`       | Ork told a node that a link was made or ended                                                                                                                                                                                  |
| `run.finished`      | the run ends: `succeeded`, `failed`, `budget_exhausted`, `quota_exhausted`, `timed_out`, `interrupted`                                                                                                                         |

The decision queue adds `decision.opened`, `decision.answered`,
`decision.withdrawn` and `run.command` ([messaging](../messaging.md)); a pause
adds `node.held` and `node.released`
([run control](../run-control.md#what-a-run-records)); a heavy command that
waits for a machine-wide slot adds `slot.waiting` (with who holds the slots) and
`slot.taken` ([machine](../machine.md#a-wait-is-shown)); a node that names a
`lock:` ([RFC-016](../../rfcs/archived/RFC-016-integration-lock.md)) adds
`lock.waiting` (`lock`, `holders` as `<run>/<node>`) while another run holds it,
`lock.taken` (`lock`) when it runs under it, and `lock.released` (`lock`, `end`:
`span` when the last node naming it ended, `run` when the run ended holding it,
whose locked nodes a resume runs again under the lock); a `once: true` check
that did not run adds `verify.skipped` with the command, the time of the earlier
pass and who ran it ([check once](../check-once.md#in-a-workflow)).

The run result lists each node (runs, ok, last output, cost), the total cost,
the reasons the run did not succeed, and the worktrees it left for the user. It
also counts the nodes skipped (`skipped`: those that never ran) and the failures
an edge handled (`failuresHandled`: a failed result with an edge or loop taken),
so a `succeeded` run says what it left out, and names each node that never ran
with messages nobody read (`unread: [{ node, messages }]`): a branch not taken
leaves its mail. All three come from the routing a resume replays, so a resumed
run counts the same; a result recorded before them lacks them.

A resumed run's result also counts `kept`: the nodes whose every result was
handed back from the run it resumed, which are in `nodes` with their runs but
did not run again. A node that ran anew at least once (a later round, an item,
or its whole run) counts as ran. The summary line reads
`1 ran, 1 kept, 0 skipped`; a run that was not resumed has no `kept`, and its
line is unchanged.

`ork tree` reads a run's status as `ork ps` does: a `running` run whose process
is gone is `crashed`, and nothing will end its nodes, so a node started but not
ended reads `cut off` (not `running`) and one never started `not run`.
`ork tree --json` keeps the stored states.
