# Ork for Claude Code

Status: **Partial**: `ork mcp` ([its tools](./cli/mcp.md)), the skills
([skills](../plugins/ork/skills/),
[tests](../packages/core/test/plugin-skills.test.ts)) and the plugins
([marketplace](../.claude-plugin/marketplace.json),
[tests](../packages/cli/test/plugin.test.ts)) are built; `ork init`'s copies of
the skills are to come
([RFC-012](../rfcs/active/RFC-012-teaching-claude-code-ork.md)).

Claude Code, working with a person in their project outside any run, learns
Ork's standards from three skills and reaches Ork through `ork mcp`. It reads,
checks and starts; it never answers a decision.

## The skills

They live in [plugins/ork/skills/](../plugins/ork/skills/), one folder each, and
load as `/ork:<name>` from the plugin.

| Skill        | Teaches                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `write`      | The workflow format, node types, edges, conditions and loops, and checking each draft with `check`      |
| `run`        | Starting with `start_run`, following with `run` and `run_events`, and what only the person does         |
| `principles` | How Ork splits work: programs before sessions, spending where it pays, prevention, and a person's gates |

- **They can't teach what Ork rejects.** Every whole workflow in a skill (a YAML
  block with `schemaVersion`) is checked by a test the way `check` does, walk
  and all, and must draw no diagnostic at all.
- **Their names aren't a run's.** A run's sessions get built-in skills named
  `ork:review`, `ork:brief` and `ork:report` from a plugin also named `ork`, and
  Claude Code merges the two where both load, so these names must differ. A test
  holds the list.
- **Each says when to use it**, in a description that starts "Use when", and
  names Ork's tools, with the CLI command to use without them.

## The plugins

The repository is a Claude Code marketplace
([.claude-plugin/marketplace.json](../.claude-plugin/marketplace.json)) with two
plugins:

```
/plugin marketplace add mimshins/ork
/plugin install ork@ork          # for anyone using Ork
/plugin install ork-dev@ork      # for contributors to Ork
```

- **`ork`** ([plugins/ork/](../plugins/ork/)) has the skills above, Ork's tools
  through `ork mcp` ([.mcp.json](../plugins/ork/.mcp.json)), and a hook. Its
  server runs the `ork` on the person's `PATH`, one Ork per machine and one
  store, with `--expects` set to the plugin's version, so an older `ork` says to
  upgrade rather than fail. Without `ork` on `PATH`, Claude Code shows the
  server as failed in `/mcp`.
- **The hook** ([no-decide.ts](../plugins/ork/hooks/no-decide.ts)) runs before
  each of Claude Code's shell commands and stops `ork decide`, however `ork` is
  reached (a path, `npx @krapht/ork`, `pnpm ork`), unless it only lists
  (`--list`, `-l`). It tells Claude Code where the person answers. It stops
  accidents; it isn't a boundary ([gaps](./gaps/limits-claude-code.md)).
- **`ork-dev`** is [.ai/](../.ai/README.md) itself, as its folders already have
  a plugin's layout: the repository's own skills and agents.
- **Versions** are the CLI's: the release binds them into both `plugin.json`
  files and the `--expects` of `ork`'s server, and a test fails when one differs
  from the CLI's `package.json` ([release](../runbook/development/release.md)).
