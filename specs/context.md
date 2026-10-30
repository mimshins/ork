# Context, skills and precedence

Status: **Specified** (M1c): the context compiler is not built yet; today a
node's session gets Ork's harness instructions and the node's own `instructions`
([plan.ts](../packages/core/src/run/plan.ts)).

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
- **Model tiers and caps:** a model per node. Reviewers and sub-agents default
  to sonnet or haiku. Each node has `maxTurns` and `budgetUsd`, and the run has
  a total budget cap.
- **Bounded loops:** every cycle needs `maxRounds`. When a node hits its limit,
  it escalates to its owner, and the root escalates to a Decision.
- **Claims:** a node can claim files or resources via the `ork__claim` tool, so
  parallel workers don't collide.
