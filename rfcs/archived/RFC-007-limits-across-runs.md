# RFC-007 — Limits across runs

- **Status:** Implemented
- **Date:** 2026-11-04
- **Supersedes:** —
- **Superseded by:** —
- **ADR:** [ADR-050](../../decisions/ADR-050-limits-across-runs.md)

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Answered questions](#answered-questions)

## Context

A long unattended run should not be able to spend without limit, and several
runs should not add up to more than the user meant to spend. Today nothing looks
across runs:

- **Limits are per run** ([L39](../../specs/gaps/limits-running.md)).
  `limits.budgetUsd` is the only cap, and three runs each get the whole of it.
- **A workflow's budget is the workflow's.** It says what one run may cost, not
  what this user will spend today. It travels with the file, so it is not a
  statement about the person running it.
- **The ledger already knows the answer.** `usage` has one row per finished
  session, with its time and project, indexed on both
  ([ADR-046](../../decisions/ADR-046-usage-ledger-and-prune.md)), and is written
  in the same transaction as the session's event. `ork usage` reads it, so a cap
  on it can use the number the user already sees.
- **A subscription hits a different limit first**
  ([L74](../../specs/gaps/limits-usage.md)). Its costs are estimates, not a
  bill, and what stops it is the plan's rate limit. Ork ignores that today:
  `normalize` drops the event, so a session the plan refuses reads as a node
  that failed, and edges and `maxRounds` act on it.

### What Claude Code gives us

From the Agent SDK's types and one real session on Claude Code 2.1.318, signed
in to a subscription (`apiKeySource: none`). Both drivers emit this same JSON.

- A session emits `rate_limit_event`, documented as "for claude.ai subscription
  users" and "emitted when rate limit info changes".
- `status` (`allowed`, `allowed_warning`, `rejected`), `rateLimitType` (such as
  `five_hour` or `seven_day`) and `resetsAt` are typed, and all were present.
- The typed top-level `utilization` was **absent**. The figure was only under
  `unifiedWindows`, which the types don't declare. A rule on a percentage would
  rest on a field that isn't documented.
- `maxBudgetUsd` is the only cap Claude Code takes for a process that is
  measured in spend. It has no token cap, and it counts that process only
  ([L73](../../specs/gaps/limits-ledger.md)).
- A session reports its cost only when it finishes, so the ledger can't see a
  session that is still working.

**Not seen:** what a session does when the plan refuses it. It could not be
provoked on purpose. The types name an assistant error `rate_limit`.

## Options

### What is measured

- **A. Estimated dollars, from the ledger (chosen).** The same number as
  `ork usage`, and it can also cap a session through `maxBudgetUsd`. On a
  subscription it is a yardstick and not a bill, which the docs must say.
- **B. Tokens.** Look neutral, but a cached read counts the same as fresh
  output, so they measure consumption poorly across models. Nothing can stop a
  session at a token count, so a cap would only act between sessions.
- **C. The plan's percentage.** What a subscription user actually wants to
  watch, but the field isn't documented, and it means nothing with an API key.

### Where a cap is declared

- **A. A user file and the project's rules, both applying (chosen).**
  `~/.ork/settings.yaml` for everything on this machine, and `quotas:` in
  `.ork/project.yaml` for one project. The tightest wins, so a repository you
  cloned can lower what you spend but can't raise your own cap.
- **B. Project rules only.** No new file, but no way to say "all my projects".
- **C. In the workflow.** It would travel with the file, and a shared workflow
  would then say what its users may spend. `limits.budgetUsd` already covers
  what a workflow should say.
- **D. A flag or an environment variable.** Easy to forget on one run, which is
  when it matters.

### Which window

- **A. Calendar day, week and month, in the machine's time zone (chosen).** The
  same boundaries as `ork usage --by day|week|month`, with weeks from Monday, so
  the two never disagree. Spending right before midnight and again right after
  can pass a day's cap in any 24 hours, which is what a calendar cap means.
- **B. Rolling windows.** Smoother, but no report shows the same number, and
  "when does this free up?" has no simple answer.

### Where it is enforced

- **A. In the scheduler, wherever the run's budget is checked (chosen).** Before
  each session and call, and in what a session may spend:
  `min(node budget, what is left of the run's, what is left of any quota)`. It
  reads the ledger each time. A long run stops at its next session, and late
  turns and `verify:` retries are covered, as they already read what is left.
- **B. Only when a run starts.** Simple, but it does nothing for a run lasting
  hours, which is the case that matters.
- **C. Reservations.** A session holds what it might spend, so a cap can't be
  passed. But a session may be given all that is left, which would stop every
  other run for a while on spending that never happens.
- **D. A shared service counting live.** A local tool has no always-on process
  ([ADR-046](../../decisions/ADR-046-usage-ledger-and-prune.md)), and it
  couldn't see inside a working session anyway.

### What happens at a limit

- **A. Stop like a spent budget, and resume later (chosen).** Nothing new
  starts, and what is working goes on under the cap it was given. The run ends
  with its own status and says when the limit lifts. `ork resume` picks it up,
  which already goes on from what a run did. It is the same path as a budget,
  and it leaves no process waiting.
- **B. Wait for the limit to lift.** Better for an unattended run on a plan: it
  carries on by itself after a five-hour window. But it holds a process for up
  to a week on a seven-day window, or a month on a monthly cap, and it depends
  on how a refused session behaves, which hasn't been seen. It can be added
  later on top of A, as a setting, once that is known.
- **C. Ask the user, with a decision.** Fits someone at the keyboard, and leaves
  an unattended run sitting on an open question.

### What a plan limit does

- **A. Act only on `status: rejected`, across runs (chosen).** Keep the latest
  report for each `rateLimitType` in the store, as one write with its event.
  While any is `rejected` and its `resetsAt` is ahead, no new session starts in
  any run. A session cut off this way is cut off, not failed, so `ork resume`
  continues it rather than an edge retrying it. `allowed_warning` is shown and
  changes nothing.
- **B. Stop at a percentage of the window.** Stops before the refusal, but
  depends on the undocumented field.
- **C. Leave it out, and only cap dollars.** Simplest, but it leaves out what a
  subscription runs into first.

## Decision

Caps go in `~/.ork/settings.yaml` and `.ork/project.yaml`, and all that apply
are enforced:

```yaml
# ~/.ork/settings.yaml: every project on this machine
schemaVersion: 1
quotas:
  dayUsd: 20
  monthUsd: 300
```

```yaml
# .ork/project.yaml: this project
quotas:
  dayUsd: 5
```

- **Fields:** `dayUsd`, `weekUsd` and `monthUsd`. All are optional, and with
  none set nothing changes.
- **What counts:** the ledger's rows in the window, for all projects or this
  one, whichever the cap is for. That includes `ork chat` and called runs. A
  call into another project counts there, and against the user's caps.
- **Starting:** `ork run` refuses a workflow with a session or a call while a
  cap is spent, so it spends nothing on the tools before the first session. A
  tool-only workflow is not refused.
- **While running:** the scheduler checks at each session and call, and caps
  each session to what is left. At a spent cap it stops as for a budget and ends
  `quota_exhausted`, saying which cap and when it lifts.
- **`ork chat`** counts, and isn't stopped: the user is there, and sees a
  notice.
- **Plan limits:** as in the option above. A run stopped this way ends
  `quota_exhausted` too, and says which window and when it resets.
- **Seeing it:** `ork usage`, `--json`, `GET /api/usage` and the Usage panel
  show each cap's spend and when it resets, and any plan limit in force.
- **A status of its own:** `budget_exhausted` means raise the workflow's budget,
  and `quota_exhausted` means wait or raise the quota. A script can tell them
  apart.

The user's file is new, and holds settings only, never credentials.

## Consequences

- **A run that may spend all day has something above it,** on an API key or a
  plan, with no change to any workflow.
- **A cap can be passed.** The ledger sees only finished sessions, so runs
  already working don't see each other, and each session may spend all that was
  left when it started. The most it can pass by is what those sessions were
  given. To record in the gaps register. Lower caps or `limits.concurrency` make
  it smaller.
- **A cap reads one local store,** so it sees neither other machines nor Claude
  Code used outside Ork. It is what Ork spent here.
- **A cap is an estimate.** On a subscription it is a yardstick rather than a
  bill, so the docs say so. Plan limits are the real one.
- **A new run status** touches the store's list, the CLI's and UI's status
  displays, the feedback signals and the set of statuses a resume treats as cut
  off. It needs no migration, as the status is stored as text.
- **`schemaVersion` stays 1:** `quotas` is a new optional field, and a new file.
- **A store migration** adds the plan limits' table.
- **Closes** [L39](../../specs/gaps/limits-running.md) for spend and part of
  [L74](../../specs/gaps/limits-usage.md). `limits.concurrency` across runs
  stays open, as a separate question.
- **To update on shipping:** the usage, scheduler, workflow-format and
  event-store specs, the models-and-budgets guide and troubleshooting, the
  interaction map, the roadmap, an ADR, and a changeset.

## Answered questions

The maintainer decided these on 2026-11-04.

1. **Plan limits go in this RFC.** They share a stop path and a status with
   caps.
2. **At a limit a run stops, and `ork resume` goes on.** Waiting for a limit to
   lift can be added later as a setting.
3. **The user's file is `~/.ork/settings.yaml`.** It can hold other settings
   later, and it isn't a state file like `~/.ork/ui.json`.
4. **`ork chat` counts and shows a notice,** and isn't stopped.
5. **Two accounts on one machine are a recorded limit.** The store can't tell
   them apart, so one's rejected limit stops the other's runs until it resets.
6. **A refused session stays unproven until one is seen.** The build tests
   against a fake driver, and a gap records it, as C5 does for the SDK driver.
   That doesn't block shipping.

## After review

A review before shipping changed how this is built, and the ADR has the result.
A node now says that a limit ended it, rather than the scheduler guessing from
the ledger, as any failed session looked cut off while a limit was spent. Plan
limits on a single model hold only the session they refused, and extra usage
counts as allowed. `quota_exhausted` records no feedback signal, unlike
`budget_exhausted`, as a spent quota is about the user's settings and not the
workflow.
