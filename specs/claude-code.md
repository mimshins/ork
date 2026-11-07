# Ork for Claude Code

Status: **Built**: `ork mcp` ([its tools](./cli/mcp.md)), the skills
([skills](../plugins/ork/skills/),
[tests](../packages/core/test/plugin-skills.test.ts)), the plugins
([marketplace](../.claude-plugin/marketplace.json),
[tests](../packages/cli/test/plugin.test.ts)), and the skills' copies in a
project ([init-skills.ts](../packages/cli/src/project/init-skills.ts),
[tests](../packages/cli/test/init-skills.test.ts)). Why:
[ADR-057](../decisions/ADR-057-ork-for-claude-code.md),
[RFC-012](../rfcs/archived/RFC-012-teaching-claude-code-ork.md).

Claude Code, working with a person in their project outside any run, learns
Ork's standards from its skills and reaches Ork through `ork mcp`. It sets Ork
up when asked, reads, checks and starts; it never answers a decision.

## The skills

They live in [plugins/ork/skills/](../plugins/ork/skills/), one folder each, and
load as `/ork:<name>` from the plugin.

| Skill        | Teaches                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `write`      | The workflow format, node types, edges, conditions and loops, and checking each draft with `check`               |
| `run`        | Starting with `start_run`, following with `run` and `run_events`, and what only the person does                  |
| `principles` | How Ork splits work: programs before sessions, spending where it pays, prevention, and a person's gates          |
| `setup`      | Setting Ork up when asked: `ork doctor`, `ork init` or `ork register`, the plugin or `ork mcp`, a first workflow |

- **They can't teach what Ork rejects.** Every whole workflow in a skill (a YAML
  block with `schemaVersion`) is checked by a test the way `check` does, walk
  and all, and must draw no diagnostic at all.
- **Their names aren't a run's.** A run's sessions get built-in skills named
  `ork:review`, `ork:brief` and `ork:report` from a plugin also named `ork`, and
  Claude Code merges the two where both load, so these names must differ. A test
  holds the list.
- **Each says when to use it**, in a description that starts "Use when", and
  names Ork's tools, with the CLI command to use without them. Every
  `/ork:<name>` a skill points to is one of these, and a test holds that too.
- **`setup` asks first.** It works with or without Ork's tools, as it may run
  before `ork` is installed. It asks before it installs Ork, edits an agent's
  config, or starts a run; it never asks for a credential (the person logs in
  with each tool's own login) and never answers a decision. A test holds its
  rule. The person's side of it:
  [With your agent](../docs/getting-started/with-your-agent.md).

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
  store, with `--expects` set to the oldest Ork the plugin works with, so an
  older `ork` says to upgrade rather than fail
  ([ADR-058](../decisions/ADR-058-plugin-expects-oldest-ork.md)). Without `ork`
  on `PATH`, Claude Code shows the server as failed in `/mcp`.
- **The hook** ([no-decide.ts](../plugins/ork/hooks/no-decide.ts)) runs before
  each of Claude Code's shell commands and stops `ork decide` answering (`--id`
  or `--choose`), however `ork` is reached (a path, `npx @krapht/ork`,
  `pnpm ork`) and whatever else is on the line. Without a terminal, which Claude
  Code's shell doesn't give it, `ork decide` answers only with those, so listing
  goes ahead. It tells Claude Code where the person answers. It stops accidents;
  it isn't a boundary ([L143](./claude-code/limits.md)).
- **`ork-dev`** is [.ai/](../.ai/README.md) itself, as its folders already have
  a plugin's layout: the repository's own skills and agents.
- **Versions** are the CLI's: the release binds them into both `plugin.json`
  files, and a test fails when one differs from the CLI's `package.json`
  ([release](../runbook/development/release.md)). The `--expects` of `ork`'s
  server is kept by hand, raised only when the plugin or its skills need
  something a newer Ork added; a test fails when it names an Ork newer than the
  CLI's `package.json`.

## Copies in a project

Without the plugin, a project can carry the skills itself, so everyone who
clones it gets them:

```sh
ork init --skills
```

- **Where:** `.ork/skills/ork-<name>/SKILL.md`, which Claude Code sees as
  `/ork-write`, `/ork-run`, `/ork-principles` and `/ork-setup` through
  `.claude/skills`, which `ork init` links to `.ork/skills` unless `--no-link`.
  Their references to `/ork:<name>` read `/ork-<name>`.
- **Asked once.** `--skills` writes them and `--no-skills` doesn't. Otherwise
  `ork init` asks on a terminal, saying the plugin has them too, and only when
  the project has none; without a terminal it says how to add them.
- **Ork's copies only.** Each copy names the Ork that wrote it on the line after
  its frontmatter. `--skills` rewrites a copy Ork wrote that differs, leaves a
  current one, and never touches a skill of that name with no such line. The
  copies come from the CLI, which bundles `plugins/ork/skills/` as text
  ([plugin-skills.ts](../tools/release/plugin-skills.ts)); a test fails when the
  bundle is stale.
- **`ork doctor`** warns when a copy is older than Ork, with `ork init --skills`
  as the fix.
- **Inside a run,** a session loads them as it loads any project skill; the
  `run` skill's `start_run` isn't offered there.

## Contents

- [Limits: Ork for Claude Code](./claude-code/limits.md)
