# Limits found building end kinds

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building [how a session ends](../runtime/session-ends.md) (every node ends
as one closed kind,
[ADR-079](../../decisions/ADR-079-closed-set-of-end-kinds.md)). It closed L239
(a capped `open-code` node is now `turn_limit`) and changed how L240 reads. What
was left simpler:

- **L241 · There is no `ork runs show`.** A failed node's hint and scrubbed
  detail are in `ork run --verbose`, `ork logs --verbose` and
  `ork logs <run> --node <id>`, and the browser view's Details button names the
  last. A command that shows one node's end alone is not built.
- **L243 · Two readers still decide from `subtype`.**
  [usage.ts](../../packages/core/src/store/usage.ts) counts a failed session and
  [owner-asks.ts](../../packages/nodes/src/owner-asks.ts) reads a session's
  outcome by the driver's `subtype`, not its `end`. `subtype` stays for stored
  events; move both to `end`, then drop it.
- **L244 · The classifier's fixtures are documented formats, not captured
  runs.** The tests for
  [provider-errors.ts](../../packages/runtime/src/provider-errors.ts) use error
  bodies as Anthropic, OpenAI-style APIs, the `commandcode` provider and
  OpenCode document them, plus L240's two real errors. Replace each with a
  captured one as real sessions fail, and add a rule when `unknown` files a bug.
- **L245 · The browser view's guide link is a fixed GitHub URL.** A node's end
  links to `docs/guides/why-a-node-stopped.md` on `main` of the public
  repository, whatever version of Ork runs. Serve the guide with `ork ui`, or
  link its tag, when the browser view carries its own docs.
- **L246 · No automatic retry of a transient end.** `plan_limit`, `rate_limited`
  and `provider_unavailable` set `NodeResult.transient` and say that
  `ork resume` retries; nothing retries them by itself (only a `watch:` trigger
  reads the flag, RFC-011). Decided on 2026-11-10; a later change would add a
  policy (how many tries, how long to wait).
- **L247 · A node's end can duplicate a run-level feedback record.** A node that
  ends `budget_limit` files `end.budget_limit`, and the run's `budget.exhausted`
  records the same cause; a report the `report` tool refuses files both
  `report.rejected` and the node's `end.invalid_report`. The fingerprints
  differ, so the two stay apart in `ork feedback`. Accepted for now; drop one
  signal, or fold the records into one item, if the doubling gets in the way.
- **L248 · `budget_limit` is proven on Claude Code only.** Claude Code caps a
  node's spend itself (`--max-budget-usd`). Ork checks `budgetUsd` before a
  session and between turns, not within an OpenCode session, and `validate`
  refuses it on Command Code, so no contract case plays an over-spend there. Add
  one when those drivers report spend as it happens.
