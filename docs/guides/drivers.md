# Drivers

A **driver** is how Ork reaches an agent tool: Ork runs that tool's own
command-line program, headless, and reads what it prints. Ork has three drivers.
A workflow, a node, a node's `model` (`claude-code.opus`) or `ork run --driver`
names one by its id.

| Driver         | Runs                | Status                                      |
| -------------- | ------------------- | ------------------------------------------- |
| `claude-code`  | your own `claude`   | Proven; the one a run takes when it is here |
| `open-code`    | your own `opencode` | Proven on a real session                    |
| `command-code` | your own `cmd`      | Proven on a real session                    |

Each driver passes Ork's tests against a stand-in for its tool and has run a
real session. A driver added later is refused by `ork validate` and `ork run`
(`not yet proven on a real session`) until it has. `ork doctor` lists a driver
whose tool it can't find as `skip`, with how to install it. Logins, and what
each tool needs: [Accounts and credentials](./accounts.md).

`ork run --driver <id>` (also `ork resume` and `ork feedback apply`) looks at
that one driver's tool before any session starts. If `ork doctor` wouldn't call
it ready (the tool isn't found, or it isn't signed in), the run stops with the
driver's detail and hint. A driver named on a node, or in a model's prefix, is
checked when its session starts instead, since that node may never run.

Run Claude models on `claude-code`. Through OpenCode's `commandcode` provider
they fail after their first tool call, an error between OpenCode and that
provider; other models through it work.

## Naming the driver in the model

A `model` may start with its driver and a dot, so a node's tool and model can't
disagree:

```yaml
nodes:
  planner:
    type: agent.leader
    model: claude-code.opus
  reviewer:
    type: agent.worker
    model: command-code.deepseek/deepseek-v4.1-flash
```

The text before the first `.` is the driver when it is one of the three ids; the
rest goes to that tool as written. Anything else is a plain model for the run's
driver, so `deepseek/deepseek-v4.1-flash` still works. A prefixed node needs no
`driver`, and `ork run --driver` does not change it. `driver: open-code` with
`model: claude-code.opus` fails `ork validate`. It works in `defaults.model`, in
an agent file and in `model: "{{item.model}}"`, where each item's value is read
as it renders. Which driver a session uses, in order: the model's prefix,
`--driver`, the node's `driver`, `defaults.driver`, the driver ready on your
machine.

## What each driver does

Tools differ. Ork writes down what each driver does itself, and a node that
needs more is refused rather than half-run:

| Capability                                     | `claude-code` | `open-code`              | `command-code`           |
| ---------------------------------------------- | ------------- | ------------------------ | ------------------------ |
| Ork's tools (`ask_user`, `delegate`, messages) | yes           | yes                      | yes                      |
| Permission prompts mid-session                 | yes           | no                       | no                       |
| Cost in dollars (`budgetUsd`)                  | yes           | yes                      | no, tokens only          |
| Cap in tokens (`budgetTokens`)                 | yes           | yes                      | yes                      |
| A message mid-turn                             | yes           | no (next leg)            | no (next leg)            |
| Report as structured output                    | yes           | no (Ork's `report` tool) | no (Ork's `report` tool) |
| Turn limit (`maxTurns`)                        | yes           | yes                      | yes                      |
| A node's own MCP servers (`mcp`)               | yes           | yes                      | no                       |
| Sub-agents (`agent.subagent`)                  | yes           | no                       | no                       |

A dollar budget on a driver that reports no dollars is not refused, but warned
about (below). Where Ork has a fallback it uses it, and nothing is refused: a
driver without structured output reports through Ork's `report` tool, which
checks the report against the node's schema and sends the violations back to the
model; a message to a driver that can't take one mid-turn arrives when the
session next resumes; permissions are handled as below.

## What `ork validate` and `ork run` refuse

A node asks for something its driver does not do. Each refusal names both:

- `maxTurns` on a driver with no turn limit.
- `mcp` servers on a driver that does not load a node's own servers.
- A leader that delegates, on a driver that can't reach Ork's tools (a worker's
  own `ask_user` and run-time messages are not checked,
  [L234](../../specs/gaps.md)).
- An `agent.subagent` under a leader whose driver does not run subagents.
- A driver that is not yet proven.

`ork validate` checks against `--driver` if you give it, else against the driver
a run would take. `ork run` checks again with the real driver before any session
starts. To see every node against one driver:

```sh
ork validate --driver claude-code
```

A workflow that uses a feature only one driver has runs only on that driver;
`ork validate` says so before a run. More:
[troubleshooting](./troubleshooting/setup.md).

## What `ork validate` warns about

`budgetUsd` on a node, or `limits.budgetUsd` on the workflow, can't see a
session on a driver that reports no dollars (`command-code` today). Each is a
warning, and the run goes on:

- A node with only `budgetUsd`: "only budgetTokens applies on command-code". Add
  `budgetTokens`, which every driver can keep
  ([budgets in tokens](./models-and-budgets/models-and-limits.md#budgets-in-tokens)).
- A node under the workflow's `limits.budgetUsd`: "that limit can't see its
  sessions". Add `limits.budgetTokens`. The starter workflow `ork init` writes
  sets `limits.budgetUsd`, so on `command-code` it warns until you add one.

`ork run` prints the same warnings on stderr and starts anyway.

## Permissions: denied unless allowed

`claude-code` asks you when a tool isn't allowed, and the question shows up in
`ork decide`. `open-code` and `command-code` have no way to ask in the middle of
a session, so Ork **denies by default**: the node's `allow` and `deny` lists are
written as that tool's own rules, and everything else is refused. A node that
would have been asked about on `claude-code` is refused here, and the session
sees the refusal and goes on without it. Give the node the tools it needs in its
`allow` list.

## Command Code runs one session per checkout

Command Code keeps Ork's connection in a per-folder setting, so two sessions in
one checkout can't run together. A second waits for the first; the log says
`waiting for <checkout>: Command Code runs one session per checkout`. Ork adds
its entry before the session and removes it after, even after a crash (the next
Command Code session, or `ork doctor`, cleans up what a crash left), and leaves
your other entries as they were.

- `ork validate` **warns** where nodes could wait on each other, such as
  `shared` siblings. Give them `isolation: worktree`, or run them on another
  driver.
- `ork validate` and `ork run` **refuse** a Command Code node that owns another
  node in the same checkout: the owner holds the checkout while it waits for the
  worker, and the worker waits for the owner, so neither would finish. Give the
  worker `isolation: worktree`, or run one of them elsewhere. A Command Code
  leader can still delegate to a `claude-code` worker.

## What stays out of a session

`claude-code` and `open-code` keep your machine's own setup out of a session
([skills and context](./skills-and-context.md)): they load no MCP server but
Ork's and the ones the node names. Command Code still loads your own skills,
memory and MCP servers; Ork blocks the calls a node did not allow, but those
servers start. A project's own `.mcp.json` is never touched.
