# Writing workflows

A workflow is one YAML file, `.ork/workflows/<name>.ork.yaml`, that you commit
with your project. It names the agents and tools (the **nodes**), who owns whom,
and how work flows between them (the **edges**). This guide walks through the
parts.

## Contents

- [The shape of a file](#the-shape-of-a-file)
- [Inputs](#inputs)
- [Node types](#node-types)
- [Edges](#edges)
- [Loops](#loops)
- [Once per item](#once-per-item)
- [Templates and conditions](#templates-and-conditions)
- [Check it](#check-it)
- [Checking a workflow](./writing-workflows/checking.md): what `ork validate`
  tells you
- [Running a node once per item](./writing-workflows/running-per-item.md):
  lists, `{{item}}`, pace, results and resuming

## The shape of a file

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/workflow.schema.json
schemaVersion: 1
name: pr-fix # a lowercase slug
description: Fix a failing test, review it, then ask before opening a PR.
inputs: {} # what `ork run --input` must provide
layers: {} # skills and context for every node
defaults: {} # model, effort, driver, isolation, budgets
limits: {} # the whole run's budget, concurrency and timeout
nodes: {} # the nodes, by id
edges: [] # how work flows between them
```

The first line gives editors that support `yaml-language-server` autocomplete
and checks from Ork's [JSON Schema](../../packages/schema/workflow.schema.json).
Node ids are lowercase: letters, digits, `-` and `_`.

Ork keeps workflow files in a canonical form (stable key order, no absolute
paths), so a diff shows only what you changed. Secrets never go in the file.

## Inputs

```yaml
inputs:
  feature:
    type: string # string (the default), number or boolean
    required: true
    description: The feature to build.
  rounds:
    type: number
    default: 2
```

Pass them to `ork run`; a missing required input stops the run before anything
starts:

```sh
ork run <workflow> --input feature="dark mode" --input rounds=3
```

## Node types

| Type                              | What it does                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `agent.leader`                    | A Claude session that can plan and delegate to the nodes it owns                                                      |
| `agent.worker`                    | A Claude session that does one task and reports                                                                       |
| `agent.subagent`                  | A Claude Code subagent inside its parent's session (see below)                                                        |
| `tool.gh`, `tool.aws`, `tool.git` | Your own `gh`, `aws` or `git`, with an allow list ([`git` commits](./project-rules.md#committing-as-a-step))          |
| `tool.shell`                      | Any program, run without a shell, or a short `script:` ([scripts](./scripts.md#write-a-short-script-in-the-workflow)) |
| `control.join`                    | Waits for its inputs: `all` (default), `any`, or `n` of them                                                          |
| `control.router`, `control.split` | Pass their input on; a router takes its first matching edge, or all                                                   |
| `human.gate`                      | Asks you a question with options, and a recommended one                                                               |
| `workflow.call`                   | Starts a workflow as a separate run ([calling a workflow](./working-across-projects.md#calling-a-workflow))           |
| `mcp.call`                        | Calls one tool on an MCP server, with no session ([MCP calls](./scripts/mcp.md))                                      |

### Agent nodes

```yaml
builder:
  type: agent.worker
  prompt: "Implement: {{inputs.feature}}" # the brief
  instructions: Keep the public API unchanged. # added to its system prompt
  model: claude-code.opus
  effort: high
  isolation: worktree # worktree, continue, shared or readonly
  budgetUsd: 2 # or budgetTokens: 400000, on any driver
  maxTurns: 40
  tools:
    deny: [WebFetch]
  output:
    schema:
      verdict: [approve, escalate] # an extra field it must report
```

Every agent node ends with a **report**: `status` (`pass`, `changes_requested`,
`fail` or `done`), a short `summary`, `artifacts` (name → path in the
repository), its `branch`, and the fields of its `output.schema`. Other nodes
read the report through templates and conditions. When a node runs again in a
loop, its report replaces the last one, except for list fields named in
`output.gather` (for example `gather: [decisions]`), which keep every round's
entries.

- `isolation` decides where it works
  ([Worktrees and isolation](./worktrees.md)).
- `model`, `effort` and the budgets are in
  [Models, effort and budgets](./models-and-budgets.md).
- `mcp` names the MCP servers from `.mcp.json` a node's sessions load
  ([what a session loads](./running-workflows/running-and-answering.md#what-a-session-loads)).
- `skills` and `context` are in [Skills and context](./skills-and-context.md).
- `verify:` and `before:` run a program after or before the session
  ([steps around a session](./scripts/steps.md)).

`agent.subagent` runs inside its parent's session as a Claude Code subagent (no
edges): its `prompt` is its role, and `description` says when to use it.

### Tool nodes

```yaml
merge:
  type: tool.gh
  command: pr merge {{nodes.builder.output.branch}} --squash
  allow: [pr merge]
tests:
  type: tool.shell
  command: pnpm test
  allow: [pnpm test]
deploy:
  type: tool.aws
  command: s3 sync dist s3://my-bucket
  profile: staging # becomes --profile
  region: eu-west-1 # becomes --region
```

There is no shell: each `{{ }}` value stays one argument, so a value can't
inject a command. With `allow`, the command must start with one of its prefixes
or the node fails first. A tool node outputs `exitCode`, `stdout` and `stderr`,
and can return [JSON](./scripts.md); long output goes to `.ork/runs/`.

### Gates

```yaml
human:
  type: human.gate
  question: Merge {{nodes.builder.output.branch}}?
  options: [merge, reject]
  recommended: reject
  timeout: 30m # optional, with a default for unattended runs
  default: reject
```

A gate outputs `choice`, `answeredBy` (`user` or `timeout`) and `note`: what the
person said with their answer, empty when they said nothing. A later node reads
it as `{{nodes.human.output.note}}`, so a `revise` answer can carry what to
change, and an edge can test it, as in `when: "note != ''"`.

Keep the `question` short, and put what someone needs to read in `document`,
beside it:

```yaml
approve:
  type: human.gate
  question: Approve this spec? revise takes a note.
  document: "{{nodes.spec.output.spec}}"
  options: [approve, revise, stop]
```

`document` is a template like `question`, and is optional. Both are rendered for
a person: a list becomes `- item` lines, a list of objects one item per object
with its `key: value` lines, and an object `key: value` lines, never raw JSON.
The Decisions panel of `ork ui` shows them as Markdown (no raw HTML, tables or
images) and folds long text; a terminal shows the Markdown source. See
[Running and answering](./running-workflows/running-and-answering.md#answering-questions).

## Edges

```yaml
edges:
  - spec -> builder # one to one
  - builder -> security, ux, code # fan out
  - security, ux, code -> reviews # fan in (to a join)
  - from: reviews
    to: approver
    when: all(statuses, 'pass') # a condition
```

- An edge **without** `when:` is taken when its source succeeded: a report whose
  status is not `fail`, an exit code of 0, an answered gate.
- An edge **with** `when:` is taken when the condition holds. A bare name reads
  the source's output, so `when: verdict == 'approve'` reads the approver's
  `verdict`, and `when: status == 'fail'` handles a failure.
- A node runs whenever any incoming edge is taken; only `control.join` waits. A
  node whose every way in was not taken is skipped, and so is what follows it.

A `control.join` outputs `statuses` (each input's `status`), `results` (each
input's output) and `count`, made for conditions like
`any(statuses, 'changes_requested')`. Nodes also talk outside edges, through
[messages](./leaders-and-delegation.md#messages-between-nodes).

## Loops

A cycle needs a bound, `maxRounds`, or `ork validate` rejects it:

```yaml
- from: reviews
  to: builder
  when: any(statuses, 'changes_requested')
  maxRounds: 2
```

When a loop runs out of rounds, Ork asks
([its leader](./leaders-and-delegation.md#a-leader-decides-about-its-own-loops)
if working, else you): stop the run (recommended), allow one more round, or
carry on along the other edges. A worker sent round again starts fresh with the
reviews as its new input; a leader resumes its own session.

## Once per item

`forEach` runs a worker, a tool node, an MCP call or a workflow call once for
each entry of a list, in parallel, and gathers the results for the next node:

```yaml
build:
  type: agent.worker
  prompt: "Do this task: {{item.title}}"
  isolation: worktree
  forEach:
    from: "{{nodes.plan.output.tasks}}" # a list `plan` declared
    maxItems: 6 # required beside `from`
```

It is one node in the file and on the canvas; its items are rows in the
Monitor's node table. Read
[Running a node once per item](./writing-workflows/running-per-item.md) for the
rest, and [examples/fan-out.ork.yaml](../../examples/fan-out.ork.yaml) for a
whole workflow.

## Templates and conditions

`{{ }}` works in `prompt`, `instructions`, `command`, `cwd`, and a gate's
`question` and `document`:

- `{{inputs.feature}}`: a run input.
- `{{nodes.spec.output.artifacts.spec}}`: a field of another node's report.
- `{{run.id}}`: run metadata.
- `{{item}}` and `{{index}}`: the entry and its place, in a node with
  [`forEach`](./writing-workflows/running-per-item.md#reading-the-item).

Conditions use the same small language, with `==`, `!=`, `<`, `>`, `&&`, `||`,
`!`, and the functions `any`, `all`, `count`, `len` and `contains`. It cannot
call code, so a workflow file is safe to run.

## Check it

```sh
ork validate                    # every workflow in .ork/workflows/
ork validate path/to/file.ork.yaml
```

It reports schema errors, an unknown `parent`, cycles without `maxRounds`,
references to nodes that do not exist or do not run first, and skill or context
paths that resolve to nothing, each with its line. Then it tries every way
through the workflow without running anything
([checking a workflow](./writing-workflows/checking.md)).

A full example with every piece above:
[examples/software-factory.ork.yaml](../../examples/software-factory.ork.yaml).

For the full rules: [the workflow format](../../specs/workflow-format.md) and
[expressions](../../specs/expressions.md).
