# Node types and settings

_Part of [Workflow file format](../workflow-format.md)._

**Built-in node types in v1:**

- **Agents:** `claude.leader`, `claude.worker`, `claude.subagent`. A
  `claude.subagent` runs inside its `parent`'s session as a Claude Code subagent
  ([brief.ts](../../packages/core/src/run/brief.ts)): its role (its agent's
  instructions), `instructions` and `prompt`, rendered like a brief, are its
  system prompt, `description` says when the session uses it (the Agent tool,
  added to a `tools.only` list), and `model`, `maxTurns` and `tools.only` and
  `deny` carry over. A `claude.leader` also takes `maxWorkers` and
  `questions: owner | user` (default `user`), whether its children's questions
  go to it first ([leader questions](../messaging/leader-questions.md)). A
  leader or worker's `output.gather` names fields of its `output.schema`,
  declared as lists, that are kept across its rounds: each round's entries are
  added to the earlier ones, in order, leaving out exact repeats, while every
  other field holds the latest round
  ([gather.ts](../../packages/core/src/run/gather.ts)). `ork validate` refuses a
  field that isn't declared or isn't a list, and `gather` on a node with
  `forEach`.
- **Tools:** `tool.gh`, `tool.aws`, `tool.git`, `tool.shell` (each runs the
  user's own CLI, and a per-node allowlist sets which subcommands are
  permitted). There is one `tool.<id>` type per registered integration
  ([ADR-022](../../decisions/ADR-022-integration-registry.md)), with its own
  extra fields (AWS: `profile`, `region`). An integration may set the allow list
  a node has without one, and output fields it reads after the command:
  - `tool.git` ([ADR-034](../../decisions/ADR-034-tool-git.md)) allows `add` and
    `commit` by default (`push` only when the node's `allow` lists it), and
    outputs `staged` (`git diff --cached --stat`), `diff` (the staged patch) and
    `head` (the commit `HEAD` names) besides `exitCode`, `stdout` and `stderr`,
    so a gate after an `add` step shows what a commit will commit.
  - `tool.shell` takes `script:`, the text of a short program, instead of
    `command:`, one of them. It takes no templates, so a value can't become
    code: values arrive through `env:`. `interpreter:` is what runs it, by
    default `sh -eu`; the text is written to the run's private folder for that
    go and passed as the last argument, so `allow:` checks the interpreter
    ([RFC-006](../../rfcs/archived/RFC-006-steps-around-a-session.md)).
  - `env:` sets the program's variables. Values are templates, and only they may
    read the user's own variables, as `{{env.NAME}}`. Keys starting `ORK_` are
    refused; those are [Ork's own](../scheduler.md#built-in-node-types).
  - `plainEnv:` lists variables read as `{{env.NAME}}` that are not secret, such
    as a region, so their values are not masked in what programs print.
  - `output: { format: json }` says the program returns JSON, read as
    `output.json`: the file at `$ORK_OUTPUT` if it wrote one, otherwise its
    stdout. `schema:` under it declares the fields a later node relies on, as a
    list of values or a type (`string`, `number`, `integer`, `boolean`), and a
    value that doesn't fit fails the node ([scheduler](../scheduler.md#edges)).
    A field can also be a list, `tasks: { list: { title: string } }`: the
    optional item shape takes the rules a top-level field takes, and
    `{ list: {} }` declares no shape.
- **Waiting on a source:** tool nodes and `mcp.call` take
  `watch: { every, until, timeout, misses? }`, repeating the look until `until`
  holds, with no model turn ([watching a source](../scheduler/watching.md)).
- **Before a session:** leaders and workers take `before:`, a program run in
  their checkout first, with what `verify:` takes but `attempts`. Their `prompt`
  reads its result as `{{before.*}}`, and `defaults:` may set it
  ([steps](../scheduler/steps.md#before-a-session)).
- **Checks on a report:** leaders and workers take `verify:`, a program that
  must pass before their report is accepted, with `command` or `script`, `env`,
  `plainEnv`, `output`, `timeout` and `attempts` (default 1), and report it as
  `output.verify` ([scheduler](../scheduler/steps.md#checks-on-a-report)).
- **Messages on finishing:** leaders, workers, tool nodes, gates and calls take
  `notify:`, a list of `{ to, when?, body? }` sent through the bus when the node
  finishes, starting no session; `when:` and `body:` also read `ok` and `error`
  ([scripts and rules](../messaging/scripts.md#notify)).
- **One node per item:** workers, tool nodes, `mcp.call` and `workflow.call`
  take `forEach:`, a list to run the node once for each item of. It is
  `{ items: [...] }` (at least one entry, written in the file) or
  `{ from: "{{nodes.plan.output.tasks}}", maxItems: 8 }` (one path to an earlier
  node's list, with a required cap; a tool's JSON is read as
  `output.json.<field>`, and validate says so), and in both `maxParallel`
  (default `limits.concurrency`) and `onFailure` (`finish`, the default, or
  `stop`). The schema refuses `from` without `maxItems`, an empty `items`,
  `maxItems: 0` and a `forEach` that is not a map, each with a message that says
  what to write, and `forEach` on a leader, a gate, a sub-agent or a control
  node ([RFC-013](../../rfcs/archived/RFC-013-for-each.md)). In its `prompt`,
  `command`, `arguments`, `inputs`, `env` and `ref`, `{{item}}` and `{{index}}`
  read the item and its place; a later node reads what it gathers (`items`,
  `results`, `statuses`, `count`). What `ork validate` checks is in the
  [graph compiler](../graph-compiler.md#rules).
- **MCP calls:** `mcp.call` calls one `tool` on a `server` in the project's
  `.mcp.json`, with `arguments`, `output: { schema }`, `env`, `plainEnv` and
  `timeout`, and no session ([steps](../scheduler/steps.md#mcp-calls)).
- **Calls:** `workflow.call` starts a workflow as a separate run, in this
  project or a registered one, waits as it says, and hands back its outputs
  ([calling workflows](../scheduler/calls.md)). It takes `workflow`, and
  optionally `project` (a registered id), `node` (a leader or worker of it to
  talk to and wait on), `inputs`, `wait` (`run`, `node` or `none`), `ref`,
  `timeout` and `maxMessages`. `workflow`, `project`, `ref` and `inputs` are
  templates.
- **Control:** `control.split`, `control.join` (all, any or n),
  `control.router`. Loops are edges with `maxRounds`, not a node.
- **Human:** `human.gate`: a `question`, its `options`, and an optional
  `document` (a template, like `question`) for the long material to read before
  answering; it is shown apart from the question.
- **Edges:** `input`/`output` artifacts.

Claude nodes and `defaults` take a `model` (`opus`, `sonnet`, `haiku` or a full
model id) and an `effort` (`low`, `medium`, `high`, `xhigh`, `max`); a node's
own value wins, then `defaults`, then Claude Code's default for the model. A
spawned worker takes its template's.

Claude nodes and `defaults` also take `practices` (caveman, ponytail), on unless
turned off and inherited down the ownership tree; see
[built-in practices](../context.md#built-in-practices).

Leaders, workers and `defaults` take `mcp: [name]`: the MCP servers from the
project's `.mcp.json` the node's sessions load, beside Ork's own (none by
default). A node's list wins over `defaults` as a whole, so `mcp: []` turns the
defaults off; a spawned worker takes its template's; agents and sub-agents take
none ([what a session loads](../runtime.md#what-a-session-loads),
[ADR-067](../../decisions/ADR-067-nodes-name-mcp-servers.md)).

Leaders and workers (and agents) take `session: fresh | resume`: whether a node
that runs again continues its last session; by default a leader resumes and a
worker starts fresh ([scheduler](../scheduler.md#loops),
[ADR-033](../../decisions/ADR-033-session-resume-on-any-node.md)).

A workflow's `rules:` (`git`, `permissions`) override the project's
`.ork/project.yaml`; see [project rules](../project-rules.md).
