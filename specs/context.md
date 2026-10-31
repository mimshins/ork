# Context, skills and precedence

Status: **Built** (M1c): the context compiler
([context/](../packages/core/src/context/resolve.ts),
[tests](../packages/core/test/context.test.ts)), `ork context explain`
([cli](./cli/worktrees-agents-context-and-doctor.md#context)), and the
[built-in practices](#built-in-practices)
([practices/](../packages/core/src/practices/practices.ts)). Why:
[ADR-023](../decisions/ADR-023-context-compiler.md).

**Layers** (lowest to highest precedence for same-named skills):

1. **User global:** every skill in `~/.ork/skills/` and every `.md` file in
   `~/.ork/context/`. (Claude Code's own `~/.claude` user settings are never
   loaded; `settingSources` is `project` and `local`.)
2. **Project repo:** `CLAUDE.md` or `AGENTS.md`, `.claude/skills`,
   `.claude/agents`, loaded by Claude Code itself from the node's checkout.
3. **Workflow:** `layers.skills`, `layers.context`, and the workflow's accepted
   lessons in `.ork/lessons/<workflow>.md`.
4. **Node:** the node's own `skills`, `context` and `instructions`.

Ork's **built-in skills** (`ork:<name>`) load only where a workflow or node
names one, at that layer; Ork ships none yet. The rule is that more explicit and
more local wins, and only the winner of each name loads, so nothing is loaded
twice.

## References

- A skill reference is `ork:<name>` (a built-in) or a path to a skill folder
  (with a `SKILL.md`) starting `./` or `../`, relative to the workflow file. A
  skill's name is its `SKILL.md` `name`, else its folder's name. Project skills
  load by themselves and are not referenced.
- A context reference is a path to a file, relative to the workflow file.
- References stay inside the project (the nearest folder up with a `.git`).
- `ork validate` reports what resolves to nothing as `ref.skill` or
  `ref.context` errors, with the line; `ork run` refuses to start on them. Two
  skills with one name in the same layer are an error; a name in
  `project.skills.allow` the project does not have is a warning.

## How a node's session is compiled

- **Skills from the user, workflow and node layers** that win their name are
  copied into a plugin for the node, `.ork/runs/<run>/plugins/<node>/`, named
  `ork`, so the session sees them as `ork:<name>` (SDK `plugins`, CLI
  `--plugin-dir`).
- **Project skills** stay where Claude Code finds them. One that a higher layer
  shadows, or that `project.skills` leaves out (`ignore`, or not in `allow`), is
  switched off with Claude Code's `skillOverrides` setting (SDK `settings`, CLI
  `--settings`): it is neither listed nor invocable. Switching off a project
  skill also hides a bundled skill whose alias has its name (a project `review`
  hides `/code-review`).
- **Project instructions** are Claude Code's own: it reads `CLAUDE.md`, or
  `AGENTS.md` when there is no `CLAUDE.md` (Claude Code 2.1.281 and later;
  `ork doctor` warns on an older `claude`). Ork never adds `AGENTS.md` itself.
  `project.instructions: ignore` excludes the checkout's `CLAUDE.md`,
  `CLAUDE.local.md` and `.claude/rules` (`claudeMdExcludes`) and turns
  `AGENTS.md` reading off.
- **Context files** are appended to Claude Code's system prompt, shared before
  specific so nodes share a cached prefix: the practices, the user's context,
  the workflow's context and lessons, the [agent](#agents)'s role
  (`# Your role: <name>`), Ork's harness instructions (the node's role, its
  owner, its checkout, its children), then the node's own context and
  `instructions`. The brief is the first user message.
- In a worktree the project layer is the branch's committed one plus the copied
  local files ([worktrees](./worktrees.md#what-a-worktree-gets)).
- **`ork context explain <wf> <node>`** prints the resolved stack: each skill
  with its layer, source and state (live, or off and why), the context files,
  the practices, and estimated tokens.

## Agents

A node that names an `agent` ([workflow format](./workflow-format.md#agents))
takes the agent's settings where it sets none, and the agent's role as a section
of its system prompt. Agents come from, lowest to highest precedence for a name
([catalog.ts](../packages/core/src/agents/catalog.ts),
[tests](../packages/core/test/agents.test.ts)):

1. **User:** `~/.ork/agents/<name>.md` (and its `<name>.agent.yaml`).
2. **Project:** the agent folders of the coding-agent tools, from a registry of
   layouts ([layouts.ts](../packages/integrations/src/layouts.ts)):
   `.ai/agents`, `.opencode/agents`, `.claude/agents`, then Ork's own
   `.ork/agents`, which wins. Links are followed: a file reached through several
   folders (se-backend's `.claude/agents` and `.opencode/agents` both point at
   `.ai/agents`) counts once, under its real path.
3. **Workflow:** the workflow's inline `agents:`.

Ork has no built-in agents yet. Agents are read when the workflow is loaded, not
copied; the run records each one's source and a hash of its files on
`node.started`. An agent file's `skills` and `context` paths are relative to its
own folder. `ork agents` lists them
([cli](./cli/worktrees-agents-context-and-doctor.md#agents));
`ork context explain` names the agent that fills a node.

Claude Code also loads `.claude/agents` as its own subagents in every session,
as before: an agent can fill a node and still be a subagent a session calls.

**Token-saving practices built into the engine:**

- **Fresh agent per task:** workers start clean; only leaders are long-lived.
- **Briefs, not transcripts:** owners pass context packets and children return
  short summaries. Outputs over a threshold go to the run's artifact store and
  are referenced by path.
- **Cache-friendly prompt order:** stable prefix (system preset, skills, project
  docs, workflow context) first, the per-task brief last. Ork sets
  `ENABLE_PROMPT_CACHING_1H=1` for leaders.
- **Model tiers and caps:** a model and an effort per node, so a planner can
  think hard on opus while a reviewer runs sonnet at `low`. Reviewers and
  sub-agents default to sonnet or haiku. Each node has `maxTurns` and
  `budgetUsd`, and the run has a total budget cap.
- **Bounded loops:** every cycle needs `maxRounds`. A loop out of rounds asks
  the user ([scheduler](./scheduler.md#loops)); a child that fails inside
  `delegate` is reported to its leader.
- **Claims:** a node that may write while another does claims files, folders or
  other resources with `claim` before it edits them, so parallel workers do not
  collide ([messaging](./messaging.md#claims)).

## Built-in practices

Ork ships two practices, vendored from their upstream skills and on for every
Claude node unless turned off
([ADR-021](../decisions/ADR-021-built-in-practices.md)):

| Practice   | What it does                                                                                                                                                                                                                   | Source                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `caveman`  | Terse voice in the session's chat text, its report `summary`, and messages to other nodes; normal prose in files, code, comments, commits, docs, artifacts, and questions to the user                                          | Caveman v4.0.1 (Apache-2.0) |
| `ponytail` | The smallest complete change: reuse before writing, no unasked-for abstraction, a check for new non-trivial logic, and a closing line on what was skipped. `lite` names the smaller option; `ultra` also questions the request | Ponytail v5.3.2 (MIT)       |

- **Settings:**
  `practices: { caveman: true | false, ponytail: true | false | lite | full | ultra }`
  on `defaults` and on any Claude node; `true` is `full`.
- **Cascade:** a node takes its own setting, else its nearest owner's, else the
  workflow's `defaults`, else on. Turning a practice off on a root node turns it
  off for everything that node owns; a sub-agent follows the node it runs in.
- **Delivery:** the practices lead the session's appended system prompt, before
  Ork's harness instructions, so nodes with the same practices share a cached
  prefix.
- **No double loading:** when the node's checkout has a skill of the same name
  (`.claude/skills/<name>/SKILL.md` or `.agents/skills/<name>/SKILL.md`), the
  project's skill wins and Ork adds nothing.
- **Updating:** re-vendor a pinned upstream tag at least 7 days old, keep the
  attribution and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) current.
