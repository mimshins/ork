# Fresh sessions for a builder's next task

_Part of [Scheduler](../scheduler.md)._

Status: **Built**, off by default; its quality effect is not measured yet
([limits](../gaps/fresh-session-limits.md)).
[A changed driver](#a-changed-driver) starts a session fresh too, always, and is
built ([tests](../../packages/core/test/driver-change.test.ts)). Built: the
decision, its record on `node.started`, the handover note of earlier tasks, the
resumed-run behavior and the [`ork logs` line](../cli/running-and-runs.md)
([fresh-session.ts](../../packages/core/src/run/fresh-session.ts),
[handover.ts](../../packages/core/src/run/handover.ts),
[scheduler.ts](../../packages/core/src/run/scheduler.ts),
[context.ts](../../packages/core/src/run/context.ts),
[tests](../../packages/core/test/fresh-session.test.ts),
[note tests](../../packages/core/test/handover.test.ts),
[executor tests](../../packages/nodes/test/fresh-session.test.ts), and a
[worktree test](../../packages/core/test/worktree.test.ts)). Which drivers
report the context figure: [session ends](../runtime/session-ends.md). Why:
[ADR-103](../../decisions/ADR-103-fresh-session-for-the-next-task.md).

A worker with `session: resume` that its owner delegates to again resumes its
old session, however long it has grown. The `sessions.freshOver`
[project rule](../project-rules/sessions.md) starts that next task in a fresh
session instead, once the old session's context is over the rule's threshold.

## The rule

At an activation, Ork starts a fresh session instead of resuming when all of
these hold:

1. An owner delegated it: the activation has a brief.
2. The node is an `agent.worker` whose `session` resolves to `resume`. A child
   leader keeps resuming.
3. The node has a session to resume in this process.
4. Its last activation in this process ended `done`. One that was stopped, hit a
   limit or reported `fail` is most likely asked to finish or fix that task, so
   it resumes, whatever its context.
5. That activation's `usage.contextTokens` (the prompt of its session's last
   model request) is set and greater than `freshOver`.
6. The rule is a number: `never`, the default, and an unset rule never fire.

Otherwise the node resumes exactly as before. A loop re-entry (a node sent back,
with no brief) always resumes. The check is code over values the scheduler
already holds; no model is asked.

## Where it is decided

The scheduler decides once per activation, before `node.started`
(`createSessions` in `fresh-session.ts`, called from `perform`). The same
tracker keeps each node's session id in this process, and, for each activation
that ran (not one a resumed run handed back), its end kind and `contextTokens`.
`nodeContext` then leaves `context.resume` unset for a fresh start, so the
Claude executor builds the node's first prompt: its own `prompt`, then the
[handover note](#what-the-fresh-session-is-told) (`context.handover`), then the
task under ``## Task from `<leader>` ``, where a resumed session gets only
``## New task from `<leader>` `` and no note. `decide` runs in `perform` before
`gather` builds the context, and `ended` clears the node's `now`. A cut-off
session that `ork resume` continues still wins, as before; replay's `cutOff`
skips delegated runs, so it cannot override a fresh decision. The rule's value
is read from the effective workflow's `rules.sessions.freshOver`, where a
workflow's value wins over the project's.

## What the fresh session is told

The fresh session does not start blind: code builds a section from what the
scheduler kept for this node in this process (`handover.ts`), with no model
turn. When each delegated activation ends, the same tracker keeps its task (the
leader's `description`, else the brief's first 80 code points, whitespace
folded) and its report's `status` and `summary` (`fail` or `pass` from the
outcome when the report has no status).

The section, headed `## Your earlier tasks in this run`, holds:

- A fixed lead-in from Ork's source: these tasks were done in an earlier session
  that is not continued; their work is in this checkout; read again what you
  need.
- One entry per earlier delegated task, newest first: `### <task> (<status>)`,
  then the summary, each summary clipped to 2,000 characters so one long report
  cannot crowd out the newest task.
- A cap of 8,192 characters for the whole section (the size a sent-back input's
  note is cut at). The oldest entries that do not fit are left out, and a last
  line says how many.

It goes only into the fresh session's prompt: it is not put in an event, a log
or an artifact. It holds only text the node already had: briefs its owner gave
it and summaries its own sessions wrote. Flow activations (no brief) add no
entry. A run resumed with `ork resume` keeps no earlier tasks, so no note is
rebuilt there.

## What it records

The fresh activation's `node.started` carries `fresh: { contextTokens, over }`:
the old session's context and the threshold. No event is written for the old
session: it had already finished with its report, and is simply not resumed. No
end kind is added.

## A changed driver

A session belongs to one driver: another driver cannot resume it. A node set to
resume (`session: resume`, or a leader) whose driver now differs from the one
its last session started on starts a fresh session instead. A model's driver
prefix can cause this, as it can be rendered per run
(`model: "{{nodes.pick.output.model}}"`) or per item
([which driver](../runtime/which-driver.md)). A change of model within one
driver still resumes. A session a stopped run cut off, which `ork resume`
continues once for any node, follows the same rule. The driver a node takes now
is resolved as its plan resolves it (its rendered model's prefix, `--driver`,
the node's, the workflow's, the one ready when the run started); when it can't
be told before the node starts (its model fails to render), the session resumes
as before and the plan fails as it would.

The fresh activation's `node.started` carries `driverChanged: { from, to }`, the
two drivers. `ork logs` and the live stream print it under the start line as
`starts a fresh session: driver changed from <from> to <to>`, after the
`freshOver` line when both apply; `--json` carries the field as stored, and the
browser view ignores it ([L515](../gaps/fresh-session-limits.md)). A delegated
task also gets the handover note, as under `freshOver`. On `ork resume` the
earlier driver is read from the run's recorded events; when it cannot be read,
the session resumes as before. A run recorded before this has no
`driverChanged`.

## What carries over, and what does not

- **The worktree** belongs to the node, not its session, so the fresh session
  works in the same checkout and branch, synced from the owner as before
  ([worktrees](../worktrees.md)).
- **Spend:** each session reports its own total, keyed by node and session id,
  so the fresh session's whole cost is new and the old session's last total
  stays counted ([usage](../usage.md#what-a-resumed-session-spent)). A fresh
  start writes its prompt to the cache again, so counted tokens rise while cache
  reads fall ([tokens](../usage/tokens.md)).
- **Budgets and caps** (`budgetUsd`, `budgetTokens`, `maxTurns`) count one
  activation, fresh or resumed.
- **`ork chat`** reaches the node's latest session, the fresh one.
- **`ork resume`:** a node's sessions in the process before are not known to a
  resumed run, and delegated runs are never handed back, so a delegated builder
  already starts fresh there; the rule has nothing to decide and adds no
  `fresh`. A run recorded before the rule has no `contextTokens`, and the rule
  waits until a session in this process reports one.
