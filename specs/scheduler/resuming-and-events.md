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
- **A node cut off mid-session continues it.** When the run was stopped,
  crashed, ran out of budget or timed out (not when it failed), a node whose
  last activation never finished well resumes the Claude session it had, once,
  told that the run was stopped and to carry on from what it finished
  ([resume.ts](../../packages/core/src/run/resume.ts), `cutOff`). A node that
  failed in a failed run starts fresh.
- `run.started` carries the run's `inputs` and `settings` (`inPlace`, `driver`),
  which the resumed run starts with; the CLI records `run.resumed` with the
  nodes that keep results first.
- Questions about loops out of rounds that were answered last time get the same
  answers again, in order.
- The bus starts with the run's unread and queued messages
  ([messaging](../messaging.md#message-bus)).
- The run's budget counts what it spent before.

## Run events

`onEvent` receives every change; `ork run` stores each one in the
[event store](../event-store.md) before printing it:

| Event               | When                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run.started`       | the run starts: id, workflow, entries, every declared node and owner                                                    |
| `node.started`      | an activation starts: id, type, round, `owner` when delegated, and the `agent` that fills it (name, source, file, hash) |
| `node.event`        | a runtime event from the node's session or tool                                                                         |
| `node.finished`     | an activation ends: ok, output, usage, error                                                                            |
| `node.skipped`      | a dead path skips the node                                                                                              |
| `edge.taken`        | an edge is taken                                                                                                        |
| `loop.exhausted`    | a loop edge is out of rounds                                                                                            |
| `worktree`          | a worktree is created, committed to, merged, conflicts, or removed                                                      |
| `message.sent`      | a node wrote to another on the message bus: number, recipient, body                                                     |
| `message.read`      | a node read its inbox: the message numbers                                                                              |
| `owner.asked`       | the run asked a live owner about a loop of a node it owns                                                               |
| `owner.answered`    | the owner answered with `answer`                                                                                        |
| `owner.unanswered`  | the owner's session ended first; the human is asked instead                                                             |
| `user.message`      | `ork chat` wrote to a node: delivered now, queued, or by resuming                                                       |
| `claim.taken`       | a node claimed a resource                                                                                               |
| `claim.refused`     | a claim overlapped another node's: who holds what                                                                       |
| `claim.released`    | a node released a claim, itself or by finishing                                                                         |
| `feedback.recorded` | an agent's report, or a signal Ork derived ([feedback](../feedback.md))                                                 |
| `run.resumed`       | `ork resume` continues the run: the nodes that keep their results                                                       |
| `message.received`  | a linked node of another run wrote to this node ([messaging](../messaging/links.md))                                    |
| `link.notice`       | Ork told a node that a link was made or ended                                                                           |
| `run.finished`      | the run ends: `succeeded`, `failed`, `budget_exhausted`, `timed_out`, `interrupted`                                     |

The decision queue adds `decision.opened`, `decision.answered`,
`decision.withdrawn` and `run.command` ([messaging](../messaging.md)); a pause
adds `node.held` and `node.released`
([run control](../run-control.md#what-a-run-records)).

The run result lists each node (runs, ok, last output, cost), the total cost,
the reasons the run did not succeed, and the worktrees it left for the user.
