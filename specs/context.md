# Context, skills and precedence

Status: **Partial** (M1c): the [built-in practices](#built-in-practices) are
built ([practices/](../packages/core/src/practices/index.ts),
[tests](../packages/core/test/practices.test.ts)); the context compiler is not,
so a node's session also gets Ork's harness instructions and the node's own
`instructions` ([plan.ts](../packages/core/src/run/plan.ts)).

**Layers** (lowest to highest precedence for same-named skills or conflicting
instructions):

1. **Ork built-ins:** skills that ship with Ork, namespaced `ork:*`.
2. **User global:** `~/.ork/skills`, `~/.ork/context`.
3. **Project repo:** `CLAUDE.md`, `AGENTS.md`, `.claude/skills`,
   `.claude/agents`.
4. **Workflow:** `layers.skills`, `layers.context`, and the workflow's accepted
   lessons in `.ork/lessons/<workflow>.md`.
5. **Node:** explicit `skills`, `context` and `instructions` on the node.

The rule is that more explicit and more local wins. Only one source of the same
kind is ever loaded, so nothing is loaded twice.

**How the context compiler builds each node's session:**

- **Project layer:** passed through Claude Code's own loading
  (`settingSources: ['project','local']`, never `'user'`) so the repo works
  natively. In a worktree it is the branch's committed layer plus the copied
  local files ([worktrees](./worktrees.md#what-a-worktree-gets)). The node's
  `skills` allowlist enforces `project.skills: allowlist|ignore` and removes
  project skills shadowed by a higher layer.
- **AGENTS.md:** the CLI reads it only when no CLAUDE.md exists, and the SDK may
  not read it at all. So if the repo has AGENTS.md and no CLAUDE.md, Ork appends
  it once itself, and otherwise never adds it.
- **Ork, user, workflow and node layers:** generated into a per-run local plugin
  directory and passed through `plugins`. Plugin skills are namespaced, so they
  never collide at runtime. Precedence is resolved at compile time.
- **`ork context explain <node>`** prints the resolved stack: which file came
  from which layer, what was shadowed, and the estimated tokens.

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
- **Bounded loops:** every cycle needs `maxRounds`. When a node hits its limit,
  it escalates to its owner, and the root escalates to a Decision.
- **Claims:** a node can claim files or resources via the `ork__claim` tool, so
  parallel workers don't collide.

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
