# Core concepts

Status: **Specified**: the vocabulary every other spec uses. Parts that exist in
code are linked from their own specs. Ownership rules:
[ADR-008](../decisions/ADR-008-ownership-hierarchy.md).

| Concept            | Meaning                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow**       | A serializable graph: nodes, ownership tree, edges, inputs, layers of skills and context.                                                                                           |
| **Node**           | A typed unit, e.g. `claude.leader`, `claude.worker`, `claude.subagent`, `tool.gh`, `tool.aws`, `tool.git`, `tool.shell`, `control.*`, `human.gate`.                                 |
| **Ownership tree** | Each node has an optional `parent`. An owner delegates to children, compiles their context, receives their reports, merges their worktrees, and handles their escalations.          |
| **Edges**          | `flow` edges carry data and control in the n8n style, with optional `when` conditions and `maxRounds` for loops. `message` edges declare who may talk to whom outside the tree.     |
| **Context packet** | What an owner hands a child: a brief, selected artifacts (by path), relevant skills, and constraints. Never the owner's full transcript.                                            |
| **Report**         | What a child returns: status, a short summary, artifact paths, branch, and token and cost usage.                                                                                    |
| **Decision**       | A blocking question to the user: question, options, recommended option, context, and an optional default on timeout. Questions from all nodes are collected in one Decisions inbox. |
| **Run**            | One execution of a workflow. Every change is stored as an append-only event stream, which UI and CLI replay.                                                                        |

**Kinds of Claude node:**

- **Leader:** a long-lived session. It plans, delegates to declared children or
  spawns workers from a template (up to a cap), reviews reports and merges.
- **Worker:** a fresh session for each task, in its own worktree and branch,
  reporting to its owner.
- **Sub-agent:** runs _inside_ its parent's session as a Claude Code subagent
  (SDK `agents` option or CLI `--agents`). It is cheap and isolates context, but
  has no separate process.
