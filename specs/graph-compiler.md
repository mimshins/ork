# Graph compiler

Status: **Built** ([graph/](../packages/core/src/graph/compile.ts),
[tests](../packages/core/test/compile.test.ts)); `ork validate` runs it, and
`ork run` prints its warnings before it starts. The checks on `forEach` and
`{{item}}` ([RFC-013](../rfcs/archived/RFC-013-for-each.md), in
[for-each.ts](../packages/core/src/graph/for-each.ts),
[tests](../packages/core/test/for-each-checks.test.ts)) are built, as are the
scheduler that fans out, the walk, the CLI, the Monitor and the Builder, so
`forEach` is built end to end. Why:
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
- **Ownership:** an `agent.subagent` is owned by an `agent.leader` or
  `agent.worker` (it runs in that node's session); every other owned node is
  owned by an `agent.leader`; the tree has no cycles; a node that sets
  `isolation: continue` neither owns nor is owned.
- **Loops:** every cycle needs at least one edge with `maxRounds`.
- **Sub-agents** take no edges.
- **References** in templates and conditions must resolve (see
  [expressions](./expressions.md)); reading a node that does not run before the
  reader is a warning.
- **Known report fields** per node type: agent nodes report `status`, `summary`,
  `artifacts`, `branch`, `usage` plus their `output.schema` fields; tool nodes
  `exitCode`, `stdout`, `stderr`, plus `json` with `output: { format: json }`;
  `control.join` `statuses`, `results`, `count`; `human.gate` `choice`,
  `answeredBy`, `note`; split and router pass their input through; a
  `workflow.call`'s fields are not checked, since they depend on what it calls.

- **For each:** a node with `forEach` (RFC-013) reports `items`, `results`,
  `statuses` and `count`, which replace its type's fields for references and
  conditions, so `nodes.build.output.summary` on one is an error (`ref.field`);
  its edges' `when:` can read `statuses` and `count`. `from` must be exactly one
  path (`forEach.from-path`) to a list the source declares as `{ list: … }`
  (`forEach.not-list` when it declares something else, `forEach.undeclared` as a
  warning when nothing declares it, or, for a tool's field read outside `json`,
  naming `output.json.<field>`) and to a node that runs before
  (`forEach.order`). `{{item}}` and `{{index}}` are read only in a fanned node's
  `prompt`, `command`, `arguments`, `inputs`, `env` and `ref`, and a Claude
  node's `model` and `effort` (`item` only) (`item.outside`, also for
  `instructions`, `context`, `skills`, `before:`, `verify:` and `notify:`), and
  `{{item.<field>}}` must name a field the item shape or every static entry has
  (`item.field`; none is checked for `{ list: {} }`). Elsewhere, as in a
  `when:`, a bare `item` is a field of `output`.
- **Lock:** a node's `lock: <name>` (RFC-016) is a template like the others
  (`template.syntax`, `ref.input`), but it is taken before its node runs, so it
  may read only `inputs` and `run`: `{{nodes.*}}` is `lock.scope`, and
  `{{item}}` is `item.outside`. The compiled node carries it as `node.lock`; the
  hold is [the scheduler's](./integration.md#the-hold).
- **Values in conditions:** an edge's or a `notify:` rule's `when:` that
  compares a field with `==`, `!=`, or `any`, `all`, `count` or `contains` on a
  join's `statuses`, is checked against
  [what its source says](../packages/core/src/graph/says.ts): a Claude `status`,
  a gate's `choice`, or an `output.schema` field that lists its values. A node's
  own `status` list narrows the built-in one, and `fail` always stays, as a
  session with no good report has it (`output.status`: it can't add others). A
  router or split follows to its single input, and a loop edge into one counts
  as another input, so it isn't checked. A `workflow.call`'s status isn't
  checked, since it depends on what it calls, nor is a join's when an input has
  no list. A `watch.until` has its own check, `watch.value`.
- **Loops:** a first-match router's plain edge is its fallback, so
  `loop.beside-edge` leaves it alone. `loop.uncapped` counts the leaders and
  workers in the loop and those they own (a fanned one counts `maxItems`, or the
  length of its static list), times its rounds; a leader can spawn more, and a
  person can allow another round, so the number is a guide.

## Contents

- [Diagnostics](./graph-compiler/diagnostics.md): what each check says, its
  severity and its code, and the driver-fit checks
