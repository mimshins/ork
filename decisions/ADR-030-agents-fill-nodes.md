# ADR-030 — Agents are defined once and fill nodes

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** workflow format / agents
- **RFC:** waived — the author decided each choice directly; the options are
  below

## Context

Every Claude node carried both _who_ does the work (its role, model, tools,
output) and _where_ in the flow it sits (its task, owner, edges). In
`software-factory` the builder, the three reviewers and the approver are really
agents, written inline as nodes. Projects already define agents of their own:
se-backend keeps four role agents in `.ai/agents/`, linked into `.claude/agents`
and `.opencode/agents` so every tool reads one source. Ork could use none of
them, and the UI (M2) has no agents to offer.

## Decision

1. **An agent fills a node.** `claude.leader`, `claude.worker` and
   `claude.subagent` take `agent: <name>`. The node type is its place in the
   graph; the agent is who fills it; the node's `prompt` is its task. A node
   without `agent` is a plain node, as before.
2. **The node's own settings win.** Each setting the node leaves unset (model,
   effort, driver, skills, context, isolation, budget, turns, practices, tools,
   output schema) takes the agent's. The agent's role is its own section of the
   system prompt, after the shared layers and before Ork's harness.
3. **Agents are filled in when the workflow compiles**
   ([apply.ts](../packages/core/src/agents/apply.ts)), so every check, the
   placement of worktrees and the session plan see the effective node: an
   approver agent's `verdict` field is readable by its node's edges.
4. **An agent file is the tools' own markdown plus an Ork sidecar.** `<name>.md`
   keeps only portable frontmatter (`name`, `description`) and the role as its
   body; `<name>.agent.yaml` beside it holds Ork's settings, checked by
   `AgentSettingsSchema` and published as `agent.schema.json`. A Claude Code
   `model` in the frontmatter is honoured; the sidecar's wins.
5. **Sources, the more local winning a name:** the user's `~/.ork/agents/`; the
   project's tool folders (`.ai/agents`, `.opencode/agents`, `.claude/agents`,
   from a registry of layouts) and `.ork/agents/`; a workflow's inline
   `agents:`. A file reached through several linked folders counts once, under
   its real path. They are read live; a run records each agent's source and hash
   on `node.started`.
6. **Ork writes only its own folders.** The registry API (create, update,
   delete) and `ork agents add | rm` write `~/.ork/agents/` or `.ork/agents/`; a
   project's tool folders are read, never written.

## Options considered

- **A new node type (`type: agent`)** instead of a field: the leader/worker
  choice would move into the agent, so the same reviewer could not be both a
  standalone worker and a leader's child. Rejected.
- **Ork YAML agent files** (`<name>.agent.yaml` alone): chosen first, then
  reversed so `.ork/` can be the origin other tools link to, as se-backend's
  `.ai/` is; those tools read only markdown.
- **Ork's settings under an `ork:` key in the frontmatter:** one file per agent,
  but OpenCode 2.1 passes unknown frontmatter keys into the model request body
  (verified 2026-10-31), so Ork's settings would reach the provider on every
  call. Rejected for the sidecar, which Claude Code 2.1.316 and OpenCode both
  ignore (verified the same day).
- **Snapshots of a project's agents in Ork's store:** stable, but they drift
  from the project's own files. Rejected for reading them live with a hash.

## Consequences

- A project's existing agents work as Ork agents with no change to the project.
- An agent's `skills` and `context` paths are relative to its own folder; Ork
  rebases them onto the workflow's.
- Claude Code frontmatter beyond `model` (its `tools` list) is not mapped yet
  ([gaps](../specs/gaps.md)).
