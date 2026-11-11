# Agents

_Part of [Workflow file format](../workflow-format.md)._

An **agent** is who does an agent node's work; the node is its place in the
flow. A node names one with `agent:`, and its `prompt` is the agent's task:

```yaml
agents: # inline agents; they win over the project's and the user's
  approver:
    description: Decides whether a reviewed branch is ready to merge.
    instructions: You approve merges. Approve when … escalate when …
    model: opus
    isolation: readonly
    output: { schema: { verdict: [approve, escalate] } }
nodes:
  approver:
    type: agent.worker
    agent: approver
    prompt: Decide whether {{nodes.builder.output.branch}} is ready to merge.
```

- Each setting the node leaves unset takes the agent's: `model`, `effort`,
  `driver`, `skills`, `context`, `isolation`, `budgetUsd`, `maxTurns`,
  `practices`, `tools`, `output`. The node's own value wins, then the agent's,
  then `defaults`; `practices` go one by one, so a node that sets one keeps the
  agent's setting of the other. The agent's `instructions` are its role, a
  section of the system prompt of its own ([context](../context.md#agents)).
- Agents are filled in when the workflow compiles, so `when:` can read the
  agent's output fields. An agent no source defines is an `agent.unknown` error
  that lists the known ones.
- **Agent files** (outside the workflow): `<name>.md` with frontmatter `name`
  and `description` and the role as its body, the format Claude Code and
  OpenCode read, plus an optional `<name>.agent.yaml` sidecar beside it with the
  settings above (JSON Schema:
  [agent.schema.json](../../packages/schema/agent.schema.json)). Ork writes both
  in canonical form ([agents.ts](../../packages/schema/src/agents.ts),
  [tests](../../packages/schema/test/agents.test.ts)). Claude Code's frontmatter
  keys are read too: `model` (not `inherit`), `tools` (as `tools.only`) and
  `disallowedTools` (as `tools.deny`); the sidecar's settings win.
- **`tools`** (nodes, agents): `allow` and `deny` are permission rules added to
  the project's and workflow's; `only` names the only built-in tools the session
  has (`claude`'s `--tools`), while Ork's own tools stay.

What each type does when it runs, and how edges, joins and loops behave, is in
[Scheduler: running a workflow](../scheduler.md).
