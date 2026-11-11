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
  `human.gate` `choice`, `answeredBy`, `note`; split and router pass their input
  through; a `workflow.call`'s fields are not checked, since they depend on what
  it calls.

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

## Diagnostics

Each diagnostic has a severity, a code, a message and a path into the workflow,
which `ork validate` maps to `file:line:column`. Errors stop compilation;
warnings do not. Schema problems come first, from
[yaml.ts](../packages/schema/src/yaml.ts): `yaml.syntax` and `schema.<code>`,
and `schema.newer_version` alone for a file a newer Ork made.

| Code                     | Severity | Meaning                                                                          |
| ------------------------ | -------- | -------------------------------------------------------------------------------- |
| `tree.self`              | error    | a node owns itself                                                               |
| `tree.unknown-parent`    | error    | `parent` names no node                                                           |
| `tree.owner-kind`        | error    | the owner's type cannot own this node                                            |
| `tree.cycle`             | error    | the ownership tree has a cycle                                                   |
| `tree.continue`          | error    | an `isolation: continue` node has a parent or children                           |
| `questions.no-children`  | error    | a leader sets `questions` but owns no leader or worker that could ask            |
| `edge.syntax`            | error    | shorthand without exactly one `->`, or an empty side                             |
| `edge.unknown-node`      | error    | an edge names no node                                                            |
| `edge.subagent`          | error    | an edge touches a sub-agent                                                      |
| `edge.when-syntax`       | error    | a `when:` does not parse                                                         |
| `edge.duplicate`         | warning  | the same edge is declared twice                                                  |
| `edge.max-rounds-unused` | warning  | `maxRounds` on an edge outside any cycle                                         |
| `graph.unbounded-cycle`  | error    | a cycle has no `maxRounds` edge                                                  |
| `when.value`             | error    | a condition compares a field with a value it can't have (see below)              |
| `output.status`          | error    | a Claude node declares a `status` a session can't report                         |
| `when.never`             | warning  | a condition that reads nothing and is false                                      |
| `loop.no-condition`      | warning  | no edge of a loop has a `when:`, so only its rounds can end it                   |
| `loop.beside-edge`       | warning  | a plain edge from the node a loop edge leaves, which fires every round           |
| `loop.uncapped`          | warning  | a loop of sessions with no `limits.budgetUsd` or `limits.timeout`                |
| `graph.no-entry`         | error    | no node can start                                                                |
| `graph.unreachable`      | warning  | a node no entry reaches through edges or ownership                               |
| `join.inputs`            | warning  | a join has fewer than two inputs                                                 |
| `join.n`                 | error    | mode `n` without `n`, or `n` above the number of inputs                          |
| `router.conditions`      | warning  | a router whose edges have no `when:`                                             |
| `gate.option`            | error    | `recommended` or `default` is not an option, or ids repeat                       |
| `gate.timeout`           | error    | a `timeout` without a `default`                                                  |
| `input.required-default` | warning  | a required input with a default that is never used                               |
| `message.self`           | error    | a channel from a node to itself                                                  |
| `message.endpoint`       | error    | a channel endpoint has no session, program, or call naming a node                |
| `tool.command`           | error    | a `tool.shell` or step with neither or both of `command` and `script`            |
| `script.template`        | error    | a `{{` in a `script:`, whose values come through `env:`                          |
| `script.interpreter`     | error    | an `interpreter:` with no `script:`, or a template in one                        |
| `verify.field`           | error    | an `output.schema` field called `verify` on a node with a `verify:`              |
| `ref.before`             | error    | a `{{before.*}}` field its step does not report                                  |
| `before.field`           | warning  | an `output.schema` field called `before`, which a bare `before` won't read       |
| `notify.target`          | error    | a `notify:` to anything but a leader or worker                                   |
| `notify.self`            | error    | a `notify:` to its own node                                                      |
| `notify.when-syntax`     | error    | a `notify:` condition that does not parse                                        |
| `notify.shadowed`        | warning  | a rule on a node with an `ok` or `error` field, which it cannot see              |
| `message.implicit`       | warning  | a channel between parent and child, which always exists                          |
| `call.parent`            | error    | a `workflow.call` with a `parent`; a leader delegates to children                |
| `call.wait-node`         | error    | a call with `wait: node` that names no node                                      |
| `call.self`              | error    | a call to its own workflow, in this project                                      |
| `call.links-off`         | error    | a call in a `messages` channel, in a workflow with links off                     |
| `call.project`           | warning  | `ork validate` only: the project is not registered on this machine               |
| `call.workflow`          | error    | `ork validate` only: the called workflow is missing or not valid                 |
| `call.node`              | error    | `ork validate` only: `node` is no leader or worker of it                         |
| `call.input`             | error    | `ork validate` only: a required input of it is not given                         |
| `driver.unfit`           | error    | `ork validate` and `ork run` only: the node's driver lacks what it needs (below) |
| `driver.queues`          | warning  | `ork validate` only: sibling sessions on a one-session-per-checkout driver wait  |
| `timeout.subagent`       | warning  | a `timeout` on a sub-agent, which runs inside its parent's session               |
| `ref.input`              | error    | a reference to an undeclared input                                               |
| `ref.node`               | error    | a reference to an unknown node, or not through `.output`                         |
| `ref.field`              | warning  | a field the node type does not report (an error on a node with `forEach`)        |
| `forEach.from-path`      | error    | `forEach.from` is not exactly one `{{ path }}`                                   |
| `forEach.not-list`       | error    | `from` reads a field its source declares as something other than a list          |
| `forEach.order`          | error    | `from` reads a node that can't have run before this one                          |
| `forEach.undeclared`     | warning  | `from` reads a list nothing declares, so a run can't check it                    |
| `forEach.channel`        | error    | a `messages` channel names a node with `forEach`                                 |
| `forEach.notify`         | error    | a `notify:` rule goes to a node with `forEach`                                   |
| `forEach.continue`       | error    | a node with `forEach` continues one worktree without `maxParallel: 1`            |
| `forEach.unreached`      | error    | a child with `forEach` has no edge into it, so nothing can run it                |
| `forEach.owner-order`    | error    | a child with `forEach` merges into an owner that starts only after it            |
| `item.outside`           | error    | `{{item}}` or `{{index}}` outside the templates of a node with `forEach`         |
| `item.field`             | error    | `{{item.<field>}}` names a field the item shape or static entries lack           |
| `model.template`         | error    | `model` is a template off a fanned node, or reads more than `item`               |
| `effort.template`        | error    | `effort` is a template off a fanned node, or reads more than `item`              |
| `model.item`             | error    | a written item's `model` is empty or has a space, brace or quote                 |
| `effort.item`            | error    | a written item's `effort` is not `low`, `medium`, `high`, `xhigh` or `max`       |
| `ref.undeclared`         | warning  | a field of a tool's or MCP call's JSON that no `output.schema` declares          |
| `ref.json`               | error    | `output.json` of a tool node without `output: { format: json }`                  |
| `env.reserved`           | error    | an `env:` key starting `ORK_`                                                    |
| `env.literal`            | warning  | a literal under a secret-looking name, or a URL with a password                  |
| `env.code`               | warning  | a run's data sets a name that changes which code runs (`PATH`)                   |
| `env.plain`              | warning  | `plainEnv` names what `env:` doesn't read, or looks like a secret                |
| `template.env`           | error    | `{{env.*}}` outside a tool node's `env:`, or an edge's `when:`                   |
| `mcp.unknown`            | error    | a Claude node's `mcp:` names a server `.mcp.json` doesn't have                   |
| `mcp.reserved`           | error    | a Claude node's `mcp:` names `ork`, Ork's own server                             |
| `mcp.malformed`          | error    | a Claude node's `mcp:` names a `.mcp.json` entry that can't load                 |
| `ref.skill`              | error    | a skill reference that resolves to nothing (context compiler)                    |
| `ref.context`            | error    | a context file that does not exist (context compiler)                            |
| `template.syntax`        | error    | a template does not parse                                                        |
| `template.scope`         | error    | a template reads outside `inputs`, `nodes` and `run`                             |
| `template.not-upstream`  | warning  | a template reads a node that does not run first                                  |

### Driver fit

`ork validate` (against `--driver` if given, else the driver a run would take,
the one ready here, looked up whenever a session node names none) and `ork run`
(again with the real driver, before anything is spent) read only each driver's
declared `capabilities`, `proven` and `onePerCheckout`
([drivers.ts](../packages/integrations/src/drivers.ts),
[driver-needs.ts](../packages/core/src/run/driver-needs.ts)) and refuse, in
words that name both the node and the driver: `maxTurns` without `turnLimit`;
`budgetUsd`, or the workflow's `limits.budgetUsd`, without `price` (a token
budget comes with RFC-015); `mcp` servers without `mcpServers`; a leader that
delegates to the nodes it owns without `questions`; any node on a driver that is
not `proven`; an owner and a node it owns in one checkout on a `onePerCheckout`
driver (below). Not refused, because Ork has a fallback: the report, permission
rules, a message at the next leg. A node with no driver to check (none ready) is
left to the run's own refusal.

A `onePerCheckout` driver (Command Code: its MCP entry is per folder, so a
checkout holds one session at a time) gets a warning, `driver.queues`, from
[driver-queues.ts](../packages/core/src/run/driver-queues.ts), in `ork validate`
only. It names the driver and the sibling session nodes that work in one
checkout and could run at once, and says what to do: give them separate
worktrees, or run them on another driver. Which checkout a node works in follows
[worktrees](./worktrees.md#where-each-node-works): `isolation: worktree` is its
own; `shared` and `readonly` use the nearest owner's worktree or the project
checkout. Two nodes could run at once unless an edge orders them. An owner holds
its checkout while the nodes it owns there wait for it, so the run would never
finish: that is the `driver.unfit` refusal above, at the owner. A `forEach` node
in a shared checkout counts unless `maxParallel: 1`. Limits: `continue` and an
unowned `readonly` node (which follow their input, so run after it) are left
out, and `limits.concurrency` is not read, so a workflow limited to one session
at a time still warns. One warning per checkout, at its first node.
