# Workflow file format

Status: **Built**: the Zod model, edge shorthand, canonical YAML, diagnostics,
[agents](#agents), `rules:` and the JSON Schemas
([code](../packages/schema/src/index.ts),
[tests](../packages/schema/test/yaml.test.ts)); node types execute in the
[scheduler](./scheduler.md). Why:
[ADR-006](../decisions/ADR-006-workflow-file-format.md),
[ADR-030](../decisions/ADR-030-agents-fill-nodes.md).

**Files:**

- `.ork/workflows/<name>.ork.yaml`: the committed workflow.

**Serialization rules:**

- Where a node sits on a canvas isn't stored: it follows from the nodes and
  edges ([ADR-051](../decisions/ADR-051-workflow-builder.md)). A
  `<name>.layout.json` left from before is ignored.
- Stable node ids.
- Deterministic key order.
- No absolute paths.
- Secrets only as `{{env.NAME}}` references in a tool node's `env:`.
- `schemaVersion`, checked on every read. A file with a higher version was made
  by a newer Ork, and gets that one message (`schema.newer_version`, with
  `ork upgrade` as the fix) instead of `expected 1`; the same goes for
  `project.yaml`, `triggers.yaml` and settings. There are no migrations yet: the
  first arrives with the first version 2.
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

- A workflow may declare `outputs:`, a map of names to templates over its nodes,
  rendered when the run ends and handed to a
  [`workflow.call`](./scheduler/calls.md) that called it. It is optional.
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

- **Agents:** `claude.leader`, `claude.worker`, `claude.subagent`. A
  `claude.subagent` runs inside its `parent`'s session as a Claude Code subagent
  ([brief.ts](../packages/core/src/run/brief.ts)): its role (its agent's
  instructions), `instructions` and `prompt`, rendered like a brief, are its
  system prompt, `description` says when the session uses it (the Agent tool,
  added to a `tools.only` list), and `model`, `maxTurns` and `tools.only` and
  `deny` carry over. A `claude.leader` also takes `maxWorkers` and
  `questions: owner | user` (default `user`), whether its children's questions
  go to it first ([leader questions](./messaging/leader-questions.md)).
- **Tools:** `tool.gh`, `tool.aws`, `tool.git`, `tool.shell` (each runs the
  user's own CLI, and a per-node allowlist sets which subcommands are
  permitted). There is one `tool.<id>` type per registered integration
  ([ADR-022](../decisions/ADR-022-integration-registry.md)), with its own extra
  fields (AWS: `profile`, `region`). An integration may set the allow list a
  node has without one, and output fields it reads after the command:
  - `tool.git` ([ADR-034](../decisions/ADR-034-tool-git.md)) allows `add` and
    `commit` by default (`push` only when the node's `allow` lists it), and
    outputs `staged` (`git diff --cached --stat`), `diff` (the staged patch) and
    `head` (the commit `HEAD` names) besides `exitCode`, `stdout` and `stderr`,
    so a gate after an `add` step shows what a commit will commit.
  - `tool.shell` takes `script:`, the text of a short program, instead of
    `command:`, one of them. It takes no templates, so a value can't become
    code: values arrive through `env:`. `interpreter:` is what runs it, by
    default `sh -eu`; the text is written to the run's private folder for that
    go and passed as the last argument, so `allow:` checks the interpreter
    ([RFC-006](../rfcs/archived/RFC-006-steps-around-a-session.md)).
  - `env:` sets the program's variables. Values are templates, and only they may
    read the user's own variables, as `{{env.NAME}}`. Keys starting `ORK_` are
    refused; those are [Ork's own](./scheduler.md#built-in-node-types).
  - `plainEnv:` lists variables read as `{{env.NAME}}` that are not secret, such
    as a region, so their values are not masked in what programs print.
  - `output: { format: json }` says the program returns JSON, read as
    `output.json`: the file at `$ORK_OUTPUT` if it wrote one, otherwise its
    stdout. `schema:` under it declares the fields a later node relies on, as a
    list of values or a type (`string`, `number`, `integer`, `boolean`), and a
    value that doesn't fit fails the node ([scheduler](./scheduler.md#edges)).
- **Waiting on a source:** tool nodes and `mcp.call` take
  `watch: { every, until, timeout, misses? }`, repeating the look until `until`
  holds, with no model turn ([watching a source](./scheduler/watching.md)).
- **Before a session:** leaders and workers take `before:`, a program run in
  their checkout first, with what `verify:` takes but `attempts`. Their `prompt`
  reads its result as `{{before.*}}`, and `defaults:` may set it
  ([steps](./scheduler/steps.md#before-a-session)).
- **Checks on a report:** leaders and workers take `verify:`, a program that
  must pass before their report is accepted, with `command` or `script`, `env`,
  `plainEnv`, `output`, `timeout` and `attempts` (default 1), and report it as
  `output.verify` ([scheduler](./scheduler/steps.md#checks-on-a-report)).
- **Messages on finishing:** leaders, workers, tool nodes, gates and calls take
  `notify:`, a list of `{ to, when?, body? }` sent through the bus when the node
  finishes, starting no session; `when:` and `body:` also read `ok` and `error`
  ([scripts and rules](./messaging/scripts.md#notify)).
- **MCP calls:** `mcp.call` calls one `tool` on a `server` in the project's
  `.mcp.json`, with `arguments`, `output: { schema }`, `env`, `plainEnv` and
  `timeout`, and no session ([steps](./scheduler/steps.md#mcp-calls)).
- **Calls:** `workflow.call` starts a workflow as a separate run, in this
  project or a registered one, waits as it says, and hands back its outputs
  ([calling workflows](./scheduler/calls.md)). It takes `workflow`, and
  optionally `project` (a registered id), `node` (a leader or worker of it to
  talk to and wait on), `inputs`, `wait` (`run`, `node` or `none`), `ref`,
  `timeout` and `maxMessages`. `workflow`, `project`, `ref` and `inputs` are
  templates.
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

Leaders and workers (and agents) take `session: fresh | resume`: whether a node
that runs again continues its last session; by default a leader resumes and a
worker starts fresh ([scheduler](./scheduler.md#loops),
[ADR-033](../decisions/ADR-033-session-resume-on-any-node.md)).

A workflow's `rules:` (`git`, `permissions`) override the project's
`.ork/project.yaml`; see [project rules](./project-rules.md).

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
  then `defaults`; `practices` go one by one, so a node that sets one keeps the
  agent's setting of the other. The agent's `instructions` are its role, a
  section of the system prompt of its own ([context](./context.md#agents)).
- Agents are filled in when the workflow compiles, so `when:` can read the
  agent's output fields. An agent no source defines is an `agent.unknown` error
  that lists the known ones.
- **Agent files** (outside the workflow): `<name>.md` with frontmatter `name`
  and `description` and the role as its body, the format Claude Code and
  OpenCode read, plus an optional `<name>.agent.yaml` sidecar beside it with the
  settings above (JSON Schema:
  [agent.schema.json](../packages/schema/agent.schema.json)). Ork writes both in
  canonical form ([agents.ts](../packages/schema/src/agents.ts),
  [tests](../packages/schema/test/agents.test.ts)). Claude Code's frontmatter
  keys are read too: `model` (not `inherit`), `tools` (as `tools.only`) and
  `disallowedTools` (as `tools.deny`); the sidecar's settings win.
- **`tools`** (nodes, agents): `allow` and `deny` are permission rules added to
  the project's and workflow's; `only` names the only built-in tools the session
  has (the SDK's `tools`, the CLI's `--tools`), while Ork's own tools stay.

What each type does when it runs, and how edges, joins and loops behave, is in
[Scheduler: running a workflow](./scheduler.md).
