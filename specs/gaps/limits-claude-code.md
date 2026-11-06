# Limits: Ork for Claude Code

_Part of [Known gaps and limits](../gaps.md)._

What Ork's Claude Code plugin and `ork mcp` do for now, by choice
([Ork for Claude Code](../claude-code.md),
[RFC-012](../../rfcs/archived/RFC-012-teaching-claude-code-ork.md)).

- **L143 · The hook on `ork decide` stops accidents, not a determined agent.**
  It reads each shell command Claude Code is about to run, and stops
  `ork decide` with `--id` or `--choose` on it. A command that reaches
  `ork decide` another way (a script it wrote, an alias, `ork ui`'s API with the
  token from `~/.ork/ui.json`) isn't stopped. It runs on the `node` on `PATH`,
  which must run TypeScript, as Node 24 does and Ork needs; an older one fails
  the hook, and Claude Code goes ahead. `ork decide` itself refuses inside a
  run, and the skills say not to answer.
- **L144 · The plugin needs `ork` on `PATH`.** It runs the person's own `ork`,
  so one Ork reads one store. Without it, or before a release with `ork mcp`,
  Claude Code shows the server as failed; an `ork` too old for the plugin
  refuses each call and says to upgrade.
- **L145 · The plugin follows `main`, not a release.** Claude Code reads the
  plugin from the marketplace's git `main`, so a skill edited between releases
  reaches plugin users at once, and could name something their Ork lacks. A
  change that needs a newer Ork lands once that Ork is published, with
  `--expects` raised to it
  ([ADR-058](../../decisions/ADR-058-plugin-expects-oldest-ork.md)); nothing
  enforces that order.
