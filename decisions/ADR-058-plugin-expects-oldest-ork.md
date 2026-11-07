# ADR-058 — The plugin expects the oldest Ork it works with

- **Status:** Accepted
- **Date:** 2026-11-06
- **Topic:** CLI / integrations / distribution
- **RFC:** waived — the maintainer chose among the options below directly, after
  a review of RFC-012's build
- **Amends:** [ADR-057](./ADR-057-ork-for-claude-code.md)

## Context

[ADR-057](./ADR-057-ork-for-claude-code.md) has Ork's Claude Code plugin run
`ork mcp --expects <version>`, and an `ork` older than that refuses every call
and says to upgrade. The release bound the CLI's own version into `--expects`.
Claude Code reads the plugin from the marketplace's git `main`, so:

- after every release, a patch one too, everyone still on the previous Ork had
  every call refused, even when nothing they used had changed;
- between merging the release pull request and the npm publish, `main` asked for
  a version npm didn't have yet, and the `ork upgrade` the refusal names found
  nothing.

## Decision

**`--expects` in [plugins/ork/.mcp.json](../plugins/ork/.mcp.json) is the oldest
Ork the plugin works with, kept by hand.** It's raised only when the plugin or
its skills come to need a tool, flag or field a newer Ork added. The release
binds the CLI's version into the plugins' `plugin.json` files and no longer
touches `--expects` ([build-info.ts](../tools/release/build-info.ts)). A test
fails when `--expects` names an Ork newer than the CLI's `package.json`
([plugin.test.ts](../packages/cli/test/plugin.test.ts)).

## Options considered

- **The oldest Ork that works (chosen):** a minimum kept by hand.
- **`major.minor.0`, bound by the release:** patch releases refuse no one, but
  each minor one still refuses everyone on the previous minor, whatever changed.
- **Keep binding the release's own version,** and record the refusals as a
  limit.

## Rationale

The refusal exists to say "this Ork lacks what the plugin uses", and only a
minimum says that truly. A version bound by the release refuses people for
releasing, not for anything missing.

## Consequences

- Whoever changes the plugin or its skills to use something new in Ork raises
  `--expects` to the first Ork that has it, and lands that change only once that
  Ork is published ([release](../runbook/development/release.md)).
- The plugin and its skills still follow `main`, so a skill edited before a
  release reaches plugin users at once
  ([limit L145](../specs/claude-code/limits.md)).
