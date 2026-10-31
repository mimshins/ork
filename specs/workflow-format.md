# Workflow file format

Status: **Built**: the Zod model, edge shorthand, canonical YAML, diagnostics,
[agents](#agents) and the JSON Schemas ([code](../packages/schema/src/index.ts),
[tests](../packages/schema/test/yaml.test.ts)); node types execute in the
[scheduler](./scheduler.md). Why:
[ADR-006](../decisions/ADR-006-workflow-file-format.md),
[ADR-030](../decisions/ADR-030-agents-fill-nodes.md).

**Files:**

- `.ork/workflows/<name>.ork.yaml`: the committed workflow.
- `.ork/workflows/<name>.layout.json`: optional canvas positions, kept separate
  so that logic diffs stay clean.

**Serialization rules:**

- Stable node ids.
- Deterministic key order.
- No absolute paths.
- Secrets only as `env:` references.
- `schemaVersion` with migrations.
- A published JSON Schema for editor autocomplete.

The canonical example is
[examples/software-factory.ork.yaml](../examples/software-factory.ork.yaml).
Edges use a shorthand where possible:

```yaml
edges:
  - spec -> builder
  - builder -> security, ux, code # fan-out
  - security, ux, code -> reviews # fan-in
  - from: reviews
    to: builder
    when: any(statuses, 'changes_requested')
    maxRounds: 2 # every cycle needs a bound
```

**Graph rules:**

- Templates use a small, safe expression language: `{{inputs.*}}`,
  `{{nodes.<id>.output.*}}` and `when:` predicates. No arbitrary JS.
- The graph compiler rejects:
  - cycles that have no `maxRounds`;
  - an unknown `parent`;
  - message edges that point to missing nodes;
  - skill and context references that don't resolve: paths are relative to the
    workflow file, and built-in skills are `ork:<name>`
    ([context](./context.md#references)).

**Built-in node types in v1:**

- **Agents:** `claude.leader`, `claude.worker`, `claude.subagent`.
- **Tools:** `tool.gh`, `tool.aws`, `tool.shell` (each runs the user's own CLI,
  and a per-node allowlist sets which subcommands are permitted). There is one
  `tool.<id>` type per registered integration
  ([ADR-022](../decisions/ADR-022-integration-registry.md)), with its own extra
  fields (AWS: `profile`, `region`).
- **Control:** `control.split`, `control.join` (all, any or n),
  `control.router`. Loops are edges with `maxRounds`, not a node.
- **Human:** `human.gate`.
- **Edges:** `input`/`output` artifacts.

Claude nodes and `defaults` take a `model` (`opus`, `sonnet`, `haiku` or a full
model id) and an `effort` (`low`, `medium`, `high`, `xhigh`, `max`); a node's
own value wins, then `defaults`, then Claude Code's default for the model. A
spawned worker takes its template's.

Claude nodes and `defaults` also take `practices` (caveman, ponytail), on unless
turned off and inherited down the ownership tree; see
[built-in practices](./context.md#built-in-practices).

## Agents

An **agent** is who does a Claude node's work; the node is its place in the
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
    type: claude.worker
    agent: approver
    prompt: Decide whether {{nodes.builder.output.branch}} is ready to merge.
```

- Each setting the node leaves unset takes the agent's: `model`, `effort`,
  `driver`, `skills`, `context`, `isolation`, `budgetUsd`, `maxTurns`,
  `practices`, `tools`, `output`. The node's own value wins, then the agent's,
  then `defaults`. The agent's `instructions` are its role, a section of the
  system prompt of its own ([context](./context.md#agents)).
- Agents are filled in when the workflow compiles, so `when:` can read the
  agent's output fields. An agent no source defines is an `agent.unknown` error
  that lists the known ones.
- **Agent files** (outside the workflow): `<name>.md` with frontmatter `name`
  and `description` and the role as its body, the format Claude Code and
  OpenCode read, plus an optional `<name>.agent.yaml` sidecar beside it with the
  settings above (JSON Schema:
  [agent.schema.json](../packages/schema/agent.schema.json)). Ork writes both in
  canonical form ([agents.ts](../packages/schema/src/agents.ts),
  [tests](../packages/schema/test/agents.test.ts)).

What each type does when it runs, and how edges, joins and loops behave, is in
[Scheduler: running a workflow](./scheduler.md).
