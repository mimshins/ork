# Graph compiler

Status: **Built** ([graph/](../packages/core/src/graph/compile.ts),
[tests](../packages/core/test/compile.test.ts)); `ork validate` runs it. Why:
[ADR-006](../decisions/ADR-006-workflow-file-format.md),
[ADR-008](../decisions/ADR-008-ownership-hierarchy.md).

`compileWorkflow(workflow)` checks what the schema cannot and, when there is no
error, returns the run graph that the [scheduler](./scheduler.md) runs: each
node with its children, incoming and outgoing edges (expanded from shorthand,
with parsed conditions), the entry nodes, and the declared message channels.

## Rules

- **Entries:** a node starts with the run when it has no owner and no incoming
  edge except `maxRounds` ones, so a first node can loop back to itself. An
  owned node with no incoming edge runs when its owner delegates to it. There
  must be at least one entry.
- **Ownership:** a `claude.subagent` is owned by a `claude.leader` or
  `claude.worker` (it runs in that node's session); every other owned node is
  owned by a `claude.leader`; the tree has no cycles; a node that sets
  `isolation: continue` neither owns nor is owned.
- **Loops:** every cycle needs at least one edge with `maxRounds`.
- **Sub-agents** take no edges.
- **References** in templates and conditions must resolve (see
  [expressions](./expressions.md)); reading a node that does not run before the
  reader is a warning.
- **Known report fields** per node type: Claude nodes report `status`,
  `summary`, `artifacts`, `branch`, `usage` plus their `output.schema` fields;
  tool nodes `exitCode`, `stdout`, `stderr`, plus `json` with
  `output: { format: json }`; `control.join` `statuses`, `results`, `count`;
  `human.gate` `choice`, `answeredBy`; split and router pass their input
  through; a `workflow.call`'s fields are not checked, since they depend on what
  it calls.

## Diagnostics

Each diagnostic has a severity, a code, a message and a path into the workflow,
which `ork validate` maps to `file:line:column`. Errors stop compilation;
warnings do not. Schema problems come first, from
[yaml.ts](../packages/schema/src/yaml.ts): `yaml.syntax` and `schema.<code>`.

| Code                     | Severity | Meaning                                                                    |
| ------------------------ | -------- | -------------------------------------------------------------------------- |
| `tree.self`              | error    | a node owns itself                                                         |
| `tree.unknown-parent`    | error    | `parent` names no node                                                     |
| `tree.owner-kind`        | error    | the owner's type cannot own this node                                      |
| `tree.cycle`             | error    | the ownership tree has a cycle                                             |
| `tree.continue`          | error    | an `isolation: continue` node has a parent or children                     |
| `edge.syntax`            | error    | shorthand without exactly one `->`, or an empty side                       |
| `edge.unknown-node`      | error    | an edge names no node                                                      |
| `edge.subagent`          | error    | an edge touches a sub-agent                                                |
| `edge.when-syntax`       | error    | a `when:` does not parse                                                   |
| `edge.duplicate`         | warning  | the same edge is declared twice                                            |
| `edge.max-rounds-unused` | warning  | `maxRounds` on an edge outside any cycle                                   |
| `graph.unbounded-cycle`  | error    | a cycle has no `maxRounds` edge                                            |
| `graph.no-entry`         | error    | no node can start                                                          |
| `graph.unreachable`      | warning  | a node no entry reaches through edges or ownership                         |
| `join.inputs`            | warning  | a join has fewer than two inputs                                           |
| `join.n`                 | error    | mode `n` without `n`, or `n` above the number of inputs                    |
| `router.conditions`      | warning  | a router whose edges have no `when:`                                       |
| `gate.option`            | error    | `recommended` or `default` is not an option, or ids repeat                 |
| `gate.timeout`           | error    | a `timeout` without a `default`                                            |
| `input.required-default` | warning  | a required input with a default that is never used                         |
| `message.self`           | error    | a channel from a node to itself                                            |
| `message.endpoint`       | error    | a channel endpoint has no session, program, or call naming a node          |
| `tool.command`           | error    | a `tool.shell` or step with neither or both of `command` and `script`      |
| `script.template`        | error    | a `{{` in a `script:`, whose values come through `env:`                    |
| `script.interpreter`     | error    | an `interpreter:` with no `script:`, or a template in one                  |
| `verify.field`           | error    | an `output.schema` field called `verify` on a node with a `verify:`        |
| `ref.before`             | error    | a `{{before.*}}` field its step does not report                            |
| `before.field`           | warning  | an `output.schema` field called `before`, which a bare `before` won't read |
| `notify.target`          | error    | a `notify:` to anything but a leader or worker                             |
| `notify.self`            | error    | a `notify:` to its own node                                                |
| `notify.when-syntax`     | error    | a `notify:` condition that does not parse                                  |
| `notify.shadowed`        | warning  | a rule on a node with an `ok` or `error` field, which it cannot see        |
| `message.implicit`       | warning  | a channel between parent and child, which always exists                    |
| `call.parent`            | error    | a `workflow.call` with a `parent`; a leader delegates to children          |
| `call.wait-node`         | error    | a call with `wait: node` that names no node                                |
| `call.self`              | error    | a call to its own workflow, in this project                                |
| `call.links-off`         | error    | a call in a `messages` channel, in a workflow with links off               |
| `call.project`           | warning  | `ork validate` only: the project is not registered on this machine         |
| `call.workflow`          | error    | `ork validate` only: the called workflow is missing or not valid           |
| `call.node`              | error    | `ork validate` only: `node` is no leader or worker of it                   |
| `call.input`             | error    | `ork validate` only: a required input of it is not given                   |
| `timeout.subagent`       | warning  | a `timeout` on a sub-agent, which runs inside its parent's session         |
| `ref.input`              | error    | a reference to an undeclared input                                         |
| `ref.node`               | error    | a reference to an unknown node, or not through `.output`                   |
| `ref.field`              | warning  | a field the node type does not report                                      |
| `ref.undeclared`         | warning  | a field of a tool's or MCP call's JSON that no `output.schema` declares    |
| `ref.json`               | error    | `output.json` of a tool node without `output: { format: json }`            |
| `env.reserved`           | error    | an `env:` key starting `ORK_`                                              |
| `env.literal`            | warning  | a literal under a secret-looking name, or a URL with a password            |
| `env.code`               | warning  | a run's data sets a name that changes which code runs (`PATH`)             |
| `env.plain`              | warning  | `plainEnv` names what `env:` doesn't read, or looks like a secret          |
| `template.env`           | error    | `{{env.*}}` outside a tool node's `env:`, or an edge's `when:`             |
| `ref.skill`              | error    | a skill reference that resolves to nothing (context compiler)              |
| `ref.context`            | error    | a context file that does not exist (context compiler)                      |
| `template.syntax`        | error    | a template does not parse                                                  |
| `template.scope`         | error    | a template reads outside `inputs`, `nodes` and `run`                       |
| `template.not-upstream`  | warning  | a template reads a node that does not run first                            |
