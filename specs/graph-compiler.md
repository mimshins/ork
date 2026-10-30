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

- **Entries:** a node starts with the run when it has no incoming edge and no
  owner. An owned node with no incoming edge runs when its owner delegates to
  it. There must be at least one entry.
- **Ownership:** a `claude.subagent` is owned by a `claude.leader` or
  `claude.worker` (it runs in that node's session); every other owned node is
  owned by a `claude.leader`; the tree has no cycles.
- **Loops:** every cycle needs at least one edge with `maxRounds`.
- **Sub-agents** take no edges.
- **References** in templates and conditions must resolve (see
  [expressions](./expressions.md)); reading a node that does not run before the
  reader is a warning.
- **Known report fields** per node type: Claude nodes report `status`,
  `summary`, `artifacts`, `branch`, `usage` plus their `output.schema` fields;
  tool nodes `exitCode`, `stdout`, `stderr`; `control.join` `statuses`,
  `results`, `count`; `human.gate` `choice`, `answeredBy`; split and router pass
  their input through.

## Diagnostics

Each diagnostic has a severity, a code, a message and a path into the workflow,
which `ork validate` maps to `file:line:column`. Errors stop compilation;
warnings do not. Schema problems come first, from
[yaml.ts](../packages/schema/src/yaml.ts): `yaml.syntax` and `schema.<code>`.

| Code                     | Severity | Meaning                                                        |
| ------------------------ | -------- | -------------------------------------------------------------- |
| `tree.self`              | error    | a node owns itself                                             |
| `tree.unknown-parent`    | error    | `parent` names no node                                         |
| `tree.owner-kind`        | error    | the owner's type cannot own this node                          |
| `tree.cycle`             | error    | the ownership tree has a cycle                                 |
| `edge.syntax`            | error    | shorthand without exactly one `->`, or an empty side           |
| `edge.unknown-node`      | error    | an edge names no node                                          |
| `edge.subagent`          | error    | an edge touches a sub-agent                                    |
| `edge.when-syntax`       | error    | a `when:` does not parse                                       |
| `edge.duplicate`         | warning  | the same edge is declared twice                                |
| `edge.max-rounds-unused` | warning  | `maxRounds` on an edge outside any cycle                       |
| `graph.unbounded-cycle`  | error    | a cycle has no `maxRounds` edge                                |
| `graph.no-entry`         | error    | no node can start                                              |
| `graph.unreachable`      | warning  | a node no entry reaches through edges or ownership             |
| `join.inputs`            | warning  | a join has fewer than two inputs                               |
| `join.n`                 | error    | mode `n` without `n`, or `n` above the number of inputs        |
| `router.conditions`      | warning  | a router whose edges have no `when:`                           |
| `gate.option`            | error    | `recommended` or `default` is not an option, or ids repeat     |
| `gate.timeout`           | error    | a `timeout` without a `default`                                |
| `input.required-default` | warning  | a required input with a default that is never used             |
| `message.self`           | error    | a channel from a node to itself                                |
| `message.endpoint`       | error    | a channel endpoint is not a `claude.leader` or `claude.worker` |
| `message.implicit`       | warning  | a channel between parent and child, which always exists        |
| `ref.input`              | error    | a reference to an undeclared input                             |
| `ref.node`               | error    | a reference to an unknown node, or not through `.output`       |
| `ref.field`              | warning  | a field the node type does not report                          |
| `ref.skill`              | error    | a skill reference that resolves to nothing (context compiler)  |
| `ref.context`            | error    | a context file that does not exist (context compiler)          |
| `template.syntax`        | error    | a template does not parse                                      |
| `template.scope`         | error    | a template reads outside `inputs`, `nodes` and `run`           |
| `template.not-upstream`  | warning  | a template reads a node that does not run first                |
