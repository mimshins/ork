# Ork for Claude Code

Status: **Partial**: `ork mcp` ([its tools](./cli/mcp.md)) and the skills are
built ([skills](../plugins/ork/skills/),
[tests](../packages/core/test/plugin-skills.test.ts)); the plugin, its hook and
`ork init`'s copies are to come
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
