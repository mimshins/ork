# RFC-012 — Teaching Claude Code Ork's standards: an MCP server and skills

- **Status:** Implemented
  ([ADR-057](../../decisions/ADR-057-ork-for-claude-code.md))
- **Date:** 2026-11-06
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions)
- [Answered questions](#answered-questions)

## Context

Ork teaches only the sessions it starts. Inside a run, each session gets an
in-process MCP server named `ork` (`report`, `delegate`, `ask_user`,
`permission` and the rest,
[tools/](../../packages/runtime-claude/src/tools/registry.ts)) and three
built-in skills, `ork:review`, `ork:brief` and `ork:report`
([builtin-skills.ts](../../packages/core/src/context/builtin-skills.ts),
[ADR-023](../../decisions/ADR-023-context-compiler.md)). Contributors to this
repository have four skills in [.ai/skills/](../../.ai/skills/).

Outside a run, Claude Code knows nothing of Ork. Asked to write a workflow, it
guesses the format, can't check its draft, and doesn't know that Ork's case is
deterministic steps first and a model only for judgment. Asked to run one, it
calls the CLI and reads its text.

### What the maintainer decided

Asked on 2026-11-06:

| Question                 | Answer                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| What agents should learn | Writing workflows; running and operating them; Ork's working principles; contributing to Ork      |
| Which agents             | Claude Code only, for now                                                                         |
| How it reaches them      | Both from the start: an `ork mcp` command, skills offered by `ork init`, and a Claude Code plugin |
| What it may do           | Read, check and start; never decide. Answering a decision or a gate stays with a person           |

### What already exists to build on

- **The same code as the CLI.** `ork ui`'s server lists projects and workflows,
  checks a draft, starts and follows runs, and reads decisions through core
  functions the CLI also uses (`packages/core/src/remote/`,
  [check.ts](../../packages/core/src/project/check.ts),
  [server](../../specs/server/api.md)).
- **The MCP SDK is already a dependency** of the CLI, at 1.32.1, for `mcp.call`
  nodes. A stdio server adds no dependency.
- **A run's sessions load project and local settings only**
  ([plan.ts](../../packages/core/src/run/plan.ts)), so a plugin a user installs
  for themselves isn't loaded inside a run. One enabled in a project's
  `.claude/settings.json` would be.

### How Claude Code plugins work

From Claude Code's documentation, read on 2026-11-06:

- A plugin is a folder with `.claude-plugin/plugin.json` (only `name` is
  required), `skills/<name>/SKILL.md`, `agents/`, `hooks/hooks.json` and
  `.mcp.json` at its root. `${CLAUDE_PLUGIN_ROOT}` works in an MCP server's
  command
  ([manifest](https://code.claude.com/docs/en/plugins/manifest-reference.md),
  [components](https://code.claude.com/docs/en/plugins/components.md)).
- A repository is a marketplace with `.claude-plugin/marketplace.json`, and a
  plugin entry's source can be a relative path. A user runs
  `/plugin marketplace add mimshins/ork`, then
  `/plugin install ork@<marketplace>`
  ([marketplaces](https://code.claude.com/docs/en/plugins/create-marketplace.md)).
- A plugin's skills are namespaced: `skills/write/SKILL.md` in plugin `ork` is
  `/ork:write`. A project's `.claude/skills/` are bare names, and both load side
  by side ([skills](https://code.claude.com/docs/en/skills.md)). A plugin's MCP
  tools are prefixed with the plugin's name, so they can't clash with the `ork`
  server inside a run.
- A plugin's `version` pins it until it changes, and updates are off by default
  for a third-party marketplace. Nothing lets a plugin require a version of a
  program on `PATH`, and a stdio server whose command is missing is marked
  failed in `/mcp`
  ([loading](https://code.claude.com/docs/en/plugins/loading.md),
  [mcp](https://code.claude.com/docs/en/mcp.md)).

## Options

How `ork mcp` gets its answers is the decision with real alternatives; the rest
follows from the maintainer's answers.

### Option A — Tools that shell out to `ork … --json`

Each tool runs the CLI and returns its JSON.

- **Pros:** the least code; every command already has `--json`.
- **Cons:** a process per call, and Node's start each time. Some commands have
  no `--json` (`ork context explain` has; `ork validate --paths` prints text).
  Errors arrive as exit codes and text to parse.

### Option B — A client of `ork ui`'s API

`ork mcp` talks to the local server over HTTP, with the token from
`~/.ork/ui.json`.

- **Pros:** one place that reads the store; the API already returns what a page
  needs.
- **Cons:** `ork ui` has to be running, or `ork mcp` starts one. The token is
  Ork's own, not a credential, but it is one more secret moving between
  processes. The API is shaped for a page, not for a model's context: events
  pages, not a short answer.

### Option C — `ork mcp` on the core functions, as the server is

`ork mcp` is a third client of the store beside the CLI and the server, calling
the same core functions in one long-lived process.

- **Pros:** the same answers as `ork validate`, `ork run --detach`, `ork ps` and
  `ork ui`, by construction. No HTTP, no token, no port. Each tool can return
  what a model needs and no more, which is Ork's token economy at the engine.
- **Cons:** a third entry point to keep in step, though it adds no logic of its
  own. A long-lived process holds the store open, as `ork ui` does.

## Decision

**Option C**, delivered three ways from one source.

### 1. `ork mcp`

A stdio MCP server in the CLI, on the core functions. Its tools:

| Tool              | Does                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `projects`        | The registered projects                                                                                      |
| `workflows`       | A project's workflows, with their inputs                                                                     |
| `workflow_format` | The format's JSON Schema, or one node type's part of it, so a model reads only what it needs                 |
| `agents`          | The agents and skills a project offers                                                                       |
| `check`           | A draft's text or a file: diagnostics with lines, the walk's summary and findings; `paths` lists the endings |
| `explain_context` | What one node's session loads, as `ork context explain`                                                      |
| `start_run`       | Starts a run detached, as `ork run --detach`, and returns its id                                             |
| `runs`            | A project's runs, newest first, with `live` and cost                                                         |
| `run`             | One run: status, what it waits on, cost, and the tree                                                        |
| `run_events`      | A run's events, newest last, filtered by node and capped                                                     |
| `usage`           | What runs spent                                                                                              |
| `decisions`       | The open decisions, to tell a person what waits on them and where to answer                                  |

No tool answers a decision, stops, pauses, continues, resumes or messages a run,
and a test lists the tools and holds this. `start_run` isn't pre-approved: it
spends money, so Claude Code asks the person each time, as for any tool.

### 2. The skills

Three for anyone writing or running workflows, in one place in this repository
(`plugins/ork/skills/`):

- **`write`**: the format, node types, conditions and loops, declaring a tool's
  output, and checking a draft with `check` until it's clean.
- **`run`**: starting, following, reading cost and what a run waits on, and
  telling the person where to answer.
- **`principles`**: how to split work: a script or a tool for what's
  deterministic, a session only for judgment, a gate for a person's decision,
  budgets on loops of sessions, and a mistake made impossible before a check is
  added.

Every workflow in a skill is a test fixture: a test runs `check`'s own code on
it and fails on an error or a walk finding, so a skill can't teach what Ork
rejects. The CLI bundles the same files, as it does the built-in run skills.

The contributor skills stay in [.ai/skills/](../../.ai/skills/), with
[.ai/agents/](../../.ai/agents/): `.ai/` becomes a second plugin, `ork-dev`, as
its folders already have a plugin's layout.

### 3. Three ways in

- **The plugin**: this repository becomes a marketplace, with `ork` (the skills,
  `ork mcp`, and a hook, below) and `ork-dev`. Its version is the CLI's, set by
  the release.
- **`ork mcp` alone**, for anyone who adds it to Claude Code by hand.
- **`ork init`** offers the three skills to the project, under `.ork/skills/`,
  which `.claude/skills` already links to, so teammates get them through git.
  Each copy names the Ork version that wrote it, and `ork doctor` says when one
  is older than the CLI.

### 4. Never decide

The tool list is the first guard. The plugin also ships a hook that stops Claude
Code running `ork decide` through its shell, and says to ask the person, who
answers in `ork ui` or a terminal. A skill alone could be ignored; the hook
can't.

## Consequences

**Better:**

- Claude Code writes workflows that pass first time, as it checks each draft the
  way `ork validate` does, and splits work the way Ork is built to save.
- What it learns can't drift from what Ork accepts: the skills' workflows are
  tests.

**Worse:**

- A third entry point to the core functions, and skill text to keep current with
  each change to the format. The fixture test catches a broken example, not a
  stale explanation.
- `ork init` writes three more files into a project, and copies can age. A
  project that also has the plugin sees both: `/ork:write` and the project's
  copy.
- The hook blocks `ork decide` even when the person types "answer it for me".
  They answer it themselves.
- The plugin needs `ork` on `PATH` at a version that knows `ork mcp`. A missing
  one shows as a failed server in `/mcp`.

**Follow-up work:**

- A spec for `ork mcp` and its tools, a chunk of [cli.md](../../specs/cli.md);
  `ork init`'s skills in [projects.md](../../specs/projects.md); the plugin's
  layout and release in the runbook.
- A guide, "Using Ork from Claude Code".
- The ADR, the gaps register, the map and the roadmap.

## Open questions

None left.

## Tried before building

On 2026-11-06, with Claude Code 2.1.318, a trial marketplace at a repository's
root beside a `packages/` folder, with two plugins (`ork` and `ork-dev`):

- `claude plugin validate` passed it, and `claude plugin marketplace add` and
  `claude plugin install ork@ork` installed both from a local path. A
  marketplace at the root needs nothing else.
- In a session, the MCP server from `.mcp.json` connected as `plugin:ork:ork`,
  its tool was `mcp__plugin_ork_ork__ping`, the skill was `/ork:write`, and a
  `PreToolUse` hook on Bash blocked `ork decide` and handed its message back.
- **A run's own plugin is also named `ork`**
  ([session.ts](../../packages/core/src/context/session.ts)). With both loaded,
  Claude Code merged them: `ork:review` and `ork:write` side by side, and the
  plugin's MCP server connected. So a project that enables the plugin in its own
  settings gives a run's sessions `start_run`. `ork mcp` has to know it's inside
  a run and offer no start there, and skill names mustn't repeat the built-in
  ones (`review`, `brief`, `report`).

## Answered questions

The maintainer's answers, on 2026-11-06, with the RFC accepted.

1. **Should `stop` be a tool?** No, for now: read, check and start only. A
   person stops a run in `ork ui` or a terminal.
2. **How should the plugin find `ork`?** On `PATH`, so there's one Ork per
   machine and one store; `ork mcp` says plainly when it's older than the
   plugin.
3. **Should the hook block `ork decide` even when the person asks Claude Code to
   answer?** Yes. Decisions stay with a person, and Claude Code says where to
   answer.
4. **Should `ork init` offer the skills when the plugin is installed?** Not
   asked: settled as this RFC proposed when it was built, on 2026-11-06. It
   can't reliably tell, so it asks once on a terminal, saying the plugin has
   them too, and only when the project has none.
