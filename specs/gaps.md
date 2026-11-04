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

None open: the last ones (G1–G7) were built on 2026-11-02.

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
  ([ADR-002](../decisions/ADR-002-typescript-from-source.md))

## Contents

- [Limits](./gaps/limits.md)
- [Limits: scripts](./gaps/limits-scripts.md)
