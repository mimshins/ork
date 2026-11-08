# Limits: workflows calling workflows

_Part of [Scheduler: running a workflow](../scheduler.md)._

How a workflow [calls another](./calls.md) works for now, by choice
([ADR-045](../../decisions/ADR-045-workflows-calling-workflows.md)). Those the
gaps review carried are open work in the [register](../gaps.md#limits).

- **L53 · A shared budget is settled late.** A called run is capped to what its
  caller had left when it started, and its cost counts against the caller only
  when the call finishes. Calls running together can overspend the caller's cap
  by up to one cap each. A `wait: none` call's cost is never counted, nor is
  what a run spends between the caller's stop and its own end. A run brought
  back by a resume keeps its old cap, so raising the caller's budget does not
  rescue one that ran out; resume it with its own higher `limits.budgetUsd`.
  ([calls](./calls.md))
- **L55 · A caller's clock runs while a called run waits on the user or between
  looks.** A node's clock pauses for its own question, but a call's and its
  run's `timeout` do not see a question in the called run. Nor is a
  `workflow.call` resting while the run it called waits between a `watch:`'s
  looks, so the caller's `limits.timeout` and the call's `timeout` go on
  running. ([calls](./calls.md))
- **L56 · Pause does not reach called runs.** A paused caller's called runs go
  on, by choice for now. ([calls](./calls.md))
- **L57 · A message to a call that never starts is lost.** Its sender was told
  `queued`, and hears nothing if the call fails first. After a caller's resume,
  a call that is not activated again has no link, so messages to it are refused
  until it is. ([links](../messaging/links.md#calls))
- **L58 · An activation cut off by a stop can tell its input twice.** A resumed
  caller gives a live called session the input again, in case it did not arrive.
  ([calls](./calls.md))
- **L59 · A called run's questions have no terminal.** They wait in `ork decide`
  or the UI's inbox even when the caller runs in a terminal, because the called
  run is a background process. ([calls](./calls.md))
- **L60 · A later activation that resumes a session waits for it.** Whatever its
  `wait`, a call whose node has reported blocks until the resumed session ends,
  since it runs in the caller's process. Its log shows the input as `you:`,
  though the message itself says it is from the workflow. ([calls](./calls.md))
- **L61 · Parallel activations of one id come back by position.** A resume hands
  a node's kept results and open runs back in order, as it always has for any
  node, so when branches activate one node id at the same time, a result or a
  run can return to a different activation than made it, with other inputs.
  Items of a fanned node have ids of their own and come back by id and round.
  ([calls](./calls.md))
