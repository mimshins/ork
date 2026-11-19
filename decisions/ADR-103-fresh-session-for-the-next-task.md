# ADR-103 — A fresh session for a worker's next delegated task

- **Status:** Accepted
- **Date:** 2026-11-19
- **Topic:** engine / sessions
- **RFC:** waived — the maintainer decided the options directly on 2026-11-19;
  they are below.
  [RFC-023](../rfcs/archived/RFC-023-extract-tool-for-session-reads.md) kept
  this (its option 5) as a follow-up that needed no decision of its own
- **Amends:** [ADR-033](./ADR-033-session-resume-on-any-node.md) (`resume` no
  longer always resumes, when the rule is on), with
  [ADR-019](./ADR-019-leaders-resume-on-reentry.md)'s defaults unchanged

## Context

A worker with `session: resume` that its owner delegates to again resumes its
old session, however long it has grown, and every later turn reads the whole
transcript again from the prompt cache. The
[option 5 estimate](../benchmarks/rfc-023-option-5/README.md) replayed 21 past
runs and found one rule that holds up: when the owner delegates a builder's
**next task** and its session context is over about 100k tokens, start that task
in a fresh session. It would have saved about 7% of builder cost (5–12% across
the re-read allowance) and about 5% of run cost, nearly all of it in the few
sessions that took four to seven tasks. The estimate could not measure quality:
a fresh builder loses what it learned on earlier tasks.

## Decision

- **The rule.** At an activation Ork starts a fresh session instead of resuming
  when an owner delegated it (it has a brief), the node is an `agent.worker`
  with `session: resume`, its last activation in the process ended `done`, that
  activation's `contextTokens` is set and over the threshold, and the threshold
  is a number. Otherwise the node resumes as before. Code decides, from values
  the scheduler already holds; no model turn.
- **The figure.** `SessionUsage.contextTokens` is the prompt of the session's
  last model request (input + cache read + cache write), set by the
  `claude-code` (main-thread requests only), `open-code` and `command-code`
  decoders, and left unset on `codex`, where the rule never fires.
- **The knob.** `sessions.freshOver` (a positive integer, or `never`) is a
  project rule, and a workflow's `rules:` overrides it. **Off by default**
  (`never`): this repository turns it on for the A/B, and a later change flips
  the default if the result holds.
- **A handover note, built by code.** The fresh session's prompt carries the
  node's earlier delegated tasks and report summaries, newest first, capped at
  8,192 characters, between the node's prompt and `## Task from <leader>`.
- **Recorded, not announced.** The fresh activation's `node.started` carries
  `fresh: { contextTokens, over }`, and `ork logs` prints one line. No event or
  end kind is added for the old session, which had already finished.

The detail is in [fresh sessions](../specs/scheduler/fresh-sessions.md) and the
[sessions rule](../specs/project-rules/sessions.md).

## Options considered

Each was decided by the maintainer on 2026-11-19; the first is the one chosen.

- **Where the knob lives (D1).** A project rule — chosen — against a node and
  agent field beside `session`, or both. The rule is one place, read like
  `reading`, with no workflow-format change; it costs a per-role override
  ([L457](../specs/gaps/fresh-session-limits.md)).
- **Default (D2).** Off — chosen — against on at 100000, or behind
  [ADR-066](./ADR-066-experiments-registry.md)'s registry. On would change every
  project with `resume` builders at upgrade with an unmeasured quality risk, and
  the registry would add a second switch and an opt-in a run does not record.
- **What the fresh session is told (D3).** A note from code — chosen — against
  nothing, the note plus the branch's changed files, or a note the old session
  writes. Nothing is the cheapest and most blind; the changed-files list waits
  on the A/B; a model-written note resumes a session of over 100k tokens for one
  more turn, against "deterministic first".
- **After which ends (D4).** Only after `done` — chosen — against after any end.
  A builder that was stopped, hit a limit or reported `fail` is most likely
  asked to finish or fix that task, and the estimate found a mid-task split does
  not pay.
- **A follow-up (D5).** The owner cannot keep the session — chosen — against a
  field on `delegate` that does. Code decides fully; the cost is a fix to the
  builder's own last task starting fresh
  ([L458](../specs/gaps/fresh-session-limits.md)).
- **A driver with no figure (D6).** The rule never fires — chosen — against the
  turn's `input_tokens` as an upper bound, or another proxy. Codex's sum was
  never checked and it has no price to show a saving
  ([L455](../specs/gaps/fresh-session-limits.md)).
- **Which nodes (D7).** Workers only — chosen — against any delegated child. A
  child leader holds its children's reports, and with `questions: owner` its
  session is what forks answer from.
- **RFC (D8).** Waived — chosen — against writing one. The estimate and the plan
  already held the alternatives.

Also ruled out: a turn cap or a split in the middle of a task (the estimate
shows neither pays), and a fresh start on a loop re-entry (the estimate's
"any-prompt" strategy did worse).

## Rationale

The estimate found one rule that saves under every allowance it tried except
twice the middle one, where it is about zero, and the saving is concentrated in
long builders. A task boundary is the only point where a builder's older context
is least likely to be needed; code can see it without a model. Because quality
was not measurable from history, the rule ships off and the same large task is
measured both ways before the default changes.

## Consequences

- No "Upgrade:" line: nothing changes until a project sets the rule.
- **Counted tokens go up.** A fresh session writes its start to the cache again,
  and cache reads, which it saves, never count, so under `budgetTokens`,
  `limits.budgetTokens` and `quotas.dayTokens` the rule only increases the
  count. On Codex and Command Code, which report no price, Ork cannot show the
  saving at all ([tokens](../specs/usage/tokens.md)).
- **Quality is unmeasured** ([L461](../specs/gaps/fresh-session-limits.md)). The
  A/B (`sessions.freshOver: never` against `100000`, same tasks, same plan,
  alternating) decides whether the default flips: under about 3% of run cost, or
  worse quality in most pairs, keeps it off.
- **A new way to be fresh beside `session: fresh`.** `fresh` is every re-entry;
  this rule is only a new delegated task over the threshold.
- Limits logged: no figure on Codex, no note after `ork resume`, no per-node
  override, no way to keep the session for a follow-up, `ork chat` reaches only
  the new session, the browser view shows nothing, and sub-agent requests may
  make the figure read low
  ([L455 to L462](../specs/gaps/fresh-session-limits.md)).
