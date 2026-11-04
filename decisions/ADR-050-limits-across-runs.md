# ADR-050 — Limits across runs

- **Status:** Accepted
- **Date:** 2026-11-04
- **Topic:** engine accounting / project rules / driver events
- **RFC:** [RFC-007](../rfcs/archived/RFC-007-limits-across-runs.md)
- **Builds on:** [ADR-046](./ADR-046-usage-ledger-and-prune.md) (the ledger)

## Context

`limits.budgetUsd` caps one run, and travels with the workflow. Nothing looked
across runs, so several runs could spend what one user never meant to. A
subscription runs into its plan's rate limit first, and Ork read a refused
session as a node that failed, so edges and `maxRounds` acted on it.

## Decision

**Caps in dollars, from the ledger.** `quotas` takes `dayUsd`, `weekUsd` and
`monthUsd`, in `~/.ork/settings.yaml` for every project and `.ork/project.yaml`
for one. All that apply are enforced, so a project can't raise the user's.
Windows are the calendar days, weeks from Monday and months `ork usage` shows,
in the machine's time zone. Tokens were rejected, as nothing can stop a session
at a token count.

**The scheduler enforces them,** wherever it checks a run's budget: before each
session and call, and in what a session may spend. A node checks again before
its session, a late turn or a `verify:` retry. It reads the ledger and the files
each time, so a changed cap reaches a running run. A called run reads them for
itself, so a call passes on only the run's budget.

**At a limit a run stops, and `ork resume` goes on.** Nothing new starts, and it
ends `quota_exhausted`, saying which limit and when it lifts. A node says when a
limit ended it, in `NodeResult.limited`, and that node counts as cut off, so no
edge acts on its failure and a resume continues the same session. The scheduler
doesn't infer this from the ledger, as a failure for any other reason while a
limit is spent must stay a failure. `ork run` refuses a workflow with a session
or a call while a limit is spent, and a tool-only one still runs. `ork chat`
counts, and only says so. Waiting for a limit to lift was left for later, as it
holds a process for up to a month.

**Plan limits act on `status: rejected` only.** `normalize` reads
`rate_limit_event` into `plan.limit`, and the store keeps the latest of each
window, so a refusal on the whole account stops every run here until `resetsAt`.
One on a single model stops only its session, and extra usage (`overageStatus`)
counts as allowed. `ork usage --clear-plan-limits` forgets them.
`allowed_warning` is shown and changes nothing. A percentage was rejected, as on
Claude Code 2.1.318 the figure sits only under `unifiedWindows`, which its types
don't declare, and the typed `utilization` was absent.

**Settings that can't be read refuse a run,** as one may hold a cap the user
relies on.

## Options considered

From RFC-007, in full there:

- **Measure:** tokens; the plan's percentage.
- **Where:** project rules only; in the workflow; a flag or variable.
- **Window:** rolling.
- **Enforcement:** only at start (nothing for a run lasting hours); reservations
  (one session's cap would stop every other run); a shared service (a local tool
  has no always-on process, and can't see inside a session).
- **At a limit:** waiting; asking the user with a decision.

## Consequences

- A long unattended run has something above it, on an API key or a plan, with no
  change to any workflow.
- A cap can be passed by what running sessions were given
  ([L99](../specs/gaps/limits-usage.md)), and sees only this machine and only
  Ork ([L100](../specs/gaps/limits-usage.md)).
- Two accounts on one machine share plan limits
  ([L101](../specs/gaps/limits-usage.md)).
- What a session does when a plan really refuses it has not been seen
  ([C11](../specs/gaps.md#chores)). Caps, the session cap, the cut-off and the
  resume were proven on a real session on the CLI driver.
- `schemaVersion` stays 1: `quotas` is a new optional field, and a new file. The
  store gains `plan_limits`.
