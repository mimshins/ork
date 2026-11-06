# Known gaps and limits

Status: **Open**: every entry waits for the review at the end of the roadmap
([roadmap](../docs/interaction-map/public/js/data/roadmap.js), item
`gaps-review`).

What Ork leaves out or does a simpler way for now, in one place, so none of it
is forgotten. Specs, ADRs and guides still describe each where it applies; this
register is the list to decide from.

- A **gap** is something specified or expected that is not built, and is not on
  the roadmap.
- A **limit** is how something built works for now, by choice.
- A **chore** is upkeep on the repository rather than on Ork.

Add an entry in the change that finds it, and remove it in the change that
closes it. At the review, each open entry is closed (built or fixed, then
removed), kept (recorded as permanent where it applies, then removed), or
carried to the next milestone.

## Gaps

G1–G7 were built on 2026-11-02.

- **G8 · A run that skipped most of its work says `succeeded`.** A run succeeds
  unless a node failed with no edge to take, so a condition that's never true,
  or a router that matched nothing, can end a run as `succeeded` with most of
  its nodes skipped, and nothing in the result says so. Found while writing
  [RFC-009](../rfcs/archived/RFC-009-walking-a-workflow.md), which checks
  workflows before they run and leaves this for its own decision.
- **G9 · Crossing the narrow window's width closes the Builder's workflow.** The
  Builder keeps what it has open in its panel's own state, and the dock and the
  one column below 64rem each mount their own panels, so a window resized or
  zoomed across that width closes the workflow. Its unsaved draft is kept, and
  opening it again brings that back; the Context panel loses the Builder's node
  meanwhile. Keeping the open workflow in the app's state, as the run selection
  is, would carry it across. Found in the Context panel's design review.
  ([workspace](./ui/workspace.md#a-narrow-window))

## Limits

Each is in [Limits](./gaps/limits.md), from L2 on.

## Chores

- **C2 · Release pull requests run no CI.** Pull requests opened with the
  built-in `GITHUB_TOKEN` trigger no workflows; the release workflow's full
  check still gates publishing. ([release](../runbook/development/release.md))
- **C5 · The examples have not run on the SDK driver.** Both ran end to end on
  the CLI driver (2026-10-31); the SDK pass needs `ANTHROPIC_API_KEY` on the
  machine that runs it. The SDK driver's pause (its hold hook and deferred
  resume) is checked only against the SDK's types and fakes until then. Links,
  timeouts and calls have only met real sessions on the CLI driver too.
  ([examples](../docs/guides/examples.md), [run control](./run-control.md))
- **C6 · The UI has no browser tests in CI.** Its components are tested in jsdom
  with axe; a slice is checked by hand in a real browser until Playwright runs
  in CI. ([ADR-040](../decisions/ADR-040-ui-stack.md))
- **C8 · The repository sets `skipLibCheck`.** dockview's declarations and the
  MCP SDK's HTTP client don't pass under `exactOptionalPropertyTypes`, so
  `packages/ui` and the root config don't check any library's declarations, and
  [mcp-sdk.d.ts](../packages/nodes/src/mcp-sdk.d.ts) retypes that client. Remove
  both when those libraries fix them.
  ([workspace](./ui/workspace.md#the-saved-layout))
- **C9 · An age exclusion waits to be removed.** `pnpm-workspace.yaml` exempts
  containerized-state 3.4.0, its React package 3.4.0 and its persistence plugin
  1.4.0 from the 7-day rule, by exact version, at their author's choice. Remove
  the list from 2026-11-10; the versions then satisfy the rule.
- **C11 · A session a plan refuses has not been seen.** Claude Code's types
  describe `rate_limit_event` and a `rate_limit` error, and one real session
  showed the event with `status: allowed`, but a refusal can't be provoked on
  purpose. Ork acts on the documented `rejected`, tested against stand-ins.
  Check it against the first real refusal: that the event comes, that the
  session ends, and that `ork resume` goes on.
  ([usage](./usage.md#limits-across-runs))
  ([ADR-002](../decisions/ADR-002-typescript-from-source.md))

## Contents

- [Limits](./gaps/limits.md)
- [Limits: scripts](./gaps/limits-scripts.md)
- [Limits: usage and quotas](./gaps/limits-usage.md)
- [Limits: the workflow builder](./gaps/limits-builder.md)
- [Limits: watching a source](./gaps/limits-watching.md)
- [Limits: design tokens](./gaps/limits-tokens.md)
- [Limits: walking a workflow](./gaps/limits-walking.md)
- [Limits: Ork for Claude Code](./gaps/limits-claude-code.md)
- [Limits: the context inspector](./gaps/limits-context-inspector.md)
