# ADR-084 — Budgets and quotas in tokens, beside dollars

- **Status:** Accepted
- **Date:** 2026-11-12
- **Topic:** workflow format, usage and limits, runtime drivers, CLI
- **RFC:** [RFC-015](../rfcs/archived/RFC-015-format-for-several-drivers.md)
  (option A, accepted 2026-11-10; its part 1 is
  [ADR-083](./ADR-083-agent-node-types-and-driver-prefixed-models.md)), and the
  maintainer's answers of 2026-11-11 on the quota and on mixed runs

## Context

Budgets were in dollars only (`budgetUsd`, `limits.budgetUsd`, `quotas.dayUsd`).
[RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md) measured that Command
Code reports tokens and no price, so a dollar cap could not bind it, and
[ADR-076](./ADR-076-cli-drivers-only.md) refused `budgetUsd` on such a driver
until this change. A run's session caps are set aside from its budget as
sessions start ([ADR-077](./ADR-077-reserve-session-caps.md)).

## Decision

- **`budgetTokens` sits wherever `budgetUsd` does:** a node, `defaults`, the
  workflow's `limits` and agent files, a positive integer. The token fields are
  new and optional, so `schemaVersion` stays 1.
- **Counted tokens are input, output and cache-write tokens. Cache reads never
  count** (about 60% of input in RFC-014's probe, and cheap). One function,
  `countedTokens`, is used by every cap, reserve, quota and report.
- **A tokens cap and a dollars cap are independent.** Neither converts to the
  other: no price table and no per-model weights. Set both and whichever is
  reached first ends the session or the run.
- **A session is stopped at its cap by the shared session runner,** once its
  counted tokens reach it, checked at each per-request usage report of every
  driver (it can pass by up to one report). It ends with the existing end kind
  `budget_limit` (subtype `error_max_budget_tokens`); no new kind joins the
  closed set of [ADR-079](./ADR-079-closed-set-of-end-kinds.md). The plan named
  it `budget_exceeded`; the engine kept the existing kind. A report already
  handed in still decides the end.
- **A run's `limits.budgetTokens` is set aside per session, as dollars are:**
  reserves hold dollars and tokens side by side, a session that doesn't fit
  waits or is refused, the run ends `budget_exhausted` once spent, and a resumed
  run starts from the tokens used.
- **`quotas.dayTokens`** sits beside `dayUsd` in `project.yaml` and the user's
  settings, summed from the usage ledger (no migration), stops new sessions at
  the cap, and is shown in `ork usage`'s Limits. A day only: no week or month in
  tokens.
- **Mixed runs are warned about and shown partial, not refused.** `budgetUsd`
  alone on a driver without `price`, or a `limits.budgetUsd` over such nodes, is
  a warning (`driver.budget`) from `ork validate` and `ork run`, replacing the
  refusal of ADR-076. A dollar total that misses such sessions is marked partial
  in `ork usage`, `ork ps` and the browser view, with the counted tokens beside
  it.

## Options considered

- **Dollars only, an unpriced driver refused for `budgetUsd`** (the state
  before). Declined: Command Code could not be capped at all.
- **Convert tokens to dollars with a price table.** Declined (out of scope,
  RFC-015): prices change, differ per model and plan, and would make a dollar
  cap look exact when it is an estimate.
- **Refuse a run that mixes priced and unpriced drivers.** Declined in RFC-015:
  mixing is useful, and a warning plus a partial mark says what is not seen.
- **A new end kind `budget_exceeded`.** Declined: `budget_limit` already means
  "reached its budget", and the set is closed.
- **Week and month token quotas.** Not built: a daily cap was what the
  maintainer asked for.

## Rationale

Every driver can then be capped, in the unit it reports, and nothing pretends to
know a price it does not have. Reusing `budget_limit`, the reserves and the
ledger kept the change to one more number on paths that already exist.

## Consequences

- A session on any driver can pass its token cap by one usage report; the
  [spec](../specs/runtime/session-ends.md#the-token-cap) says how far per
  driver. It records $0 when stopped, so a dollar limit under-counts it.
- Limits left simpler for now are
  [L278 to L284](../specs/gaps/budget-tokens-limits.md): no token budget across
  a `workflow.call`, `run.started` does not record `budgetTokens`, no
  scheduler-level test under a token budget, no partial mark per row in
  `ork usage`'s tables, the CLI's `(partial)` against the UI's `≥`, and two
  checks (`loop.uncapped`, `trigger.budget`) that still read only
  `limits.budgetUsd`.
- Specs: [usage](../specs/usage/tokens.md),
  [session ends](../specs/runtime/session-ends.md#the-token-cap),
  [scheduler](../specs/scheduler.md#budget-and-concurrency). Guide:
  [models and budgets](../docs/guides/models-and-budgets/models-and-limits.md#budgets-in-tokens).
