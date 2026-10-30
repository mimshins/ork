# Writing workflows

A workflow is one YAML file, `.ork/workflows/<name>.ork.yaml`, that you commit
with your project. It names the agents and tools (the **nodes**), who owns whom,
and how work flows between them (the **edges**). This guide walks through the
parts; the exact contract is the
[workflow format spec](../../specs/workflow-format.md).

## The shape of a file

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/mimshins/ork/main/packages/schema/workflow.schema.json
schemaVersion: 1
name: pr-fix # a lowercase slug
description: Fix a failing test, review it, then ask before opening a PR.
inputs: {} # what `ork run --input` must provide
layers: {} # skills and context for every node
defaults: {} # model, effort, driver, isolation, budgets
limits: {} # the whole run's budget and concurrency
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

Pass them as `ork run <wf> --input feature="dark mode" --input rounds=3`. A
missing required input stops the run before anything starts.

## Node types

| Type                              | What it does                                                        |
| --------------------------------- | ------------------------------------------------------------------- |
| `claude.leader`                   | A Claude session that can plan and delegate to the nodes it owns    |
| `claude.worker`                   | A Claude session that does one task and reports                     |
| `claude.subagent`                 | A Claude Code subagent inside its parent's session (see below)      |
| `tool.gh`, `tool.aws`             | Your own `gh` or `aws` CLI, with an allow list of subcommands       |
| `tool.shell`                      | Any program, run without a shell                                    |
| `control.join`                    | Waits for its inputs: `all` (default), `any`, or `n` of them        |
| `control.router`, `control.split` | Pass their input on; a router takes its first matching edge, or all |
| `human.gate`                      | Asks you a question with options, and a recommended one             |

### Claude nodes

```yaml
builder:
  type: claude.worker
  prompt: "Implement: {{inputs.feature}}" # the brief
  instructions: Keep the public API unchanged. # added to its system prompt
  model: opus
  effort: high
  isolation: worktree # worktree, shared, or readonly
  budgetUsd: 2
  maxTurns: 40
  tools:
    deny: [WebFetch]
  output:
    schema:
      verdict: [approve, escalate] # an extra field it must report
```

Every Claude node ends with a **report**: `status` (`pass`, `changes_requested`,
`fail` or `done`), a short `summary`, `artifacts` (name → path in the
repository), its `branch`, and the fields of its `output.schema`. Other nodes
read the report through templates and conditions.

- `isolation` decides where it works
  ([Worktrees and isolation](./worktrees.md)).
- `model`, `effort` and the budgets are in
  [Models, effort and budgets](./models-and-budgets.md).
- `skills` and `context` are in [Skills and context](./skills-and-context.md).

`claude.subagent` is accepted and validated (it needs a Claude `parent` and
takes no edges), but Ork does not pass it to the parent's session yet.

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

There is no shell: the command is split into arguments like a shell would, and
each `{{ }}` value stays one argument, so a value can never inject another
command. With `allow`, the command must start with one of its prefixes or the
node fails before it runs. A tool node outputs `exitCode`, `stdout` and
`stderr`; long output is cut, and the full text is kept under `.ork/runs/`.

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

A gate outputs `choice` and `answeredBy` (`user` or `timeout`).

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

## Templates and conditions

`{{ }}` templates work in a node's `prompt`, `instructions`, `command`, `cwd`
and `question`:

- `{{inputs.feature}}`: a run input.
- `{{nodes.spec.output.artifacts.spec}}`: a field of another node's report.
- `{{run.id}}`: run metadata.

Conditions use the same small language, with `==`, `!=`, `<`, `>`, `&&`, `||`,
`!`, and the functions `any`, `all`, `count`, `len` and `contains`. It cannot
call code, so a workflow file is safe to run. All of it:
[Expressions](../../specs/expressions.md).

## Check it

```sh
ork validate                    # every workflow in .ork/workflows/
ork validate path/to/file.ork.yaml
```

It reports schema errors, an unknown `parent`, cycles without `maxRounds`,
references to nodes that do not exist or do not run first, and skill or context
paths that resolve to nothing, each with its line. The full list of checks is
the [graph compiler spec](../../specs/graph-compiler.md).

A full example with every piece above:
[examples/software-factory.ork.yaml](../../examples/software-factory.ork.yaml).
