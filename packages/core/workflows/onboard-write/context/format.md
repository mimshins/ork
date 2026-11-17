# The workflow format: a writer's reference for `ork:onboard-write`

Read this with the field list Ork gives you in the prompt. The list says what a
field is called; this says what the pieces mean and how they fit. Full contract:
`specs/workflow-format.md` in the Ork repository.

## The file

One YAML file, `.ork/workflows/<name>.ork.yaml`, with `schemaVersion: 1`, a
`name`, a short `description`, optional `inputs`, `limits`, `defaults`, then
`nodes` and `edges`. Unknown keys are refused. Ork rewrites the file in its
canonical key order, so do not fuss over order or spacing.

## Node types

A node is `nodes.<id>`, with a `type`:

| Type             | What it is                                                                        |
| ---------------- | --------------------------------------------------------------------------------- |
| `agent.leader`   | A session that plans and delegates to children; `maxWorkers` caps what it spawns. |
| `agent.worker`   | A session that does one task and reports. Most work is a worker.                  |
| `agent.subagent` | Runs inside its `parent` node's session; needs `parent` and a `description`.      |
| `tool.shell`     | Runs a short program: `script:` (text) or `command:` (no shell). No model turn.   |
| `tool.git`       | Runs `git`; `allow` lists the subcommands (`add`, `commit` by default).           |
| `tool.gh`        | Runs the GitHub CLI; `allow` lists subcommands such as `pr view`.                 |
| `tool.aws`       | Runs the AWS CLI; `allow` lists subcommands; takes `profile` and `region`.        |
| `mcp.call`       | Calls one `tool` of a `server` from the project's `.mcp.json`. No model turn.     |
| `workflow.call`  | Starts another workflow as its own run and hands back its outputs.                |
| `control.split`  | Fans out: its outgoing edges all run.                                             |
| `control.join`   | Fans in; `mode` is `all` (default), `any` or `n`.                                 |
| `control.router` | Picks among outgoing edges by their `when:`; `mode` `first` (default) or `all`.   |
| `human.gate`     | Asks a person: a `question`, at least two `options`, an optional `document`.      |

A tool node runs the user's own CLI, so keep `allow` as narrow as it can be. A
tool node's `script` takes no templates: pass values through `env:`. An agent
node's `agent` is `ork-implementer` (changes things) or `ork-reviewer`
(reviews), or none; never define `agents:` yourself. Do not set `driver` or
`model`. An existing workflow keeps those it already has.

## Ownership and `isolation`

A node may name a `parent`: its owner. An owner delegates to its children and
receives their reports. Leave `parent` off unless a leader really delegates.

`isolation` says where an agent node works:

- `worktree`: its own git worktree and branch, kept across loop rounds. Use it
  for a node that edits files.
- `shared`: its nearest owner's worktree, or the project root.
- `readonly`: reads only; with no owner it works where its input came from, so a
  reviewer sees the branch of the node before it.
- `continue`: writes in the worktree its input came from (no owner, no
  children).

Tool nodes and gates work like `shared`; a tool node whose `cwd` is a worktree
counts as working there, for the node after it.

## Edges, loops and `maxRounds`

`edges` is a list. Shorthand: `a -> b`, `a -> b, c` (fan-out), `a, b -> c`
(fan-in). Object form: `{ from, to, when, maxRounds }`.

- An edge with no `when:` is taken when its source succeeded.
- `when:` is a small expression over the source's report: `choice == 'keep'` (a
  gate's answer), `exitCode == 1` (a tool node), `ok`, `any(statuses, '...')`.
  No arbitrary code.
- An edge back to an earlier node is a loop, and every loop needs `maxRounds` (a
  positive whole number) on an edge of it. A cycle with none is refused.
- Give each branch a `when:` that covers the cases you care about: a node
  reached by no taken edge does not run.

## Gates

A `human.gate` stops the run until a person picks one of its `options`. Its
answer is `choice`: route with `when: choice == 'keep'`. Put a gate before
anything that leaves the machine (a push, a pull request, a message). Use
`document` for long material the person must read; keep `question` short.
`timeout` with `default` picks an option when nobody answers: never use it
before something that leaves the machine.

## The entry node

The run starts at the entries: nodes with no owner and no incoming edge that is
not a loop. If every node has such an edge, `ork validate` fails with
`graph.no-entry` ("no node can start"). Every workflow needs at least one entry,
so check that the first node has no edge into it except a loop back. A node that
no entry reaches through edges or ownership never runs (`graph.unreachable`).

## Caps

- `limits.budgetUsd` and `limits.budgetTokens` cap the whole run; set both to
  the pick's `caps`. A run that reaches one stops.
- `limits.concurrency` caps sessions at once; `limits.timeout` caps the whole
  run.
- A node may set its own `budgetUsd`, `budgetTokens`, `maxTurns` and `timeout`.
  Keep each node's cap under the run's.
- `defaults:` sets what every node without its own value takes, such as
  `budgetUsd`.

## A minimal valid workflow

A worker fixes a failing test in its own worktree, the project's test command
checks it, a failure goes back to the worker for up to three rounds, and a
person decides before anything is kept.

```yaml
schemaVersion: 1
name: fix-failing-test
description:
  A worker fixes a failing test, the project's tests check it, a person keeps or
  discards the change.
limits:
  budgetUsd: 3
  budgetTokens: 600000
nodes:
  fix:
    type: agent.worker
    agent: ork-implementer
    prompt: Make the failing test pass. Change as little as you can.
    isolation: worktree
    tools:
      allow:
        - Read
        - Edit
  test:
    type: tool.shell
    script: pnpm test
    allow:
      - sh
    timeout: 10m
  keep:
    type: human.gate
    question: Keep the fix?
    options:
      - keep
      - discard
edges:
  - fix -> test
  - from: test
    to: fix
    when: exitCode == 1
    maxRounds: 3
  - from: test
    to: keep
    when: ok
```

Here `fix` is the entry: nothing but the loop edge from `test` points at it.
